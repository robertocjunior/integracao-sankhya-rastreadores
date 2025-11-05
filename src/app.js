import { config } from './config/index.js';
import logger from './utils/logger.js';
import { delay } from './utils/helpers.js';
import { TokenError, AtualcargoTokenError, SankhyaTokenError } from './utils/errors.js';

import * as atualcargo from './services/atualcargo.service.js';
import * as sankhya from './services/sankhya.service.js';

// --- Gerenciamento de Estado das Sessões ---
let atualcargoToken = null;
let sankhyaSessionId = null;

// [!!] MUDANÇA AQUI: Cache para os dados da Atualcargo
let cachedVehiclePositions = null;

// [NOVO] Gerenciamento de contingência Sankhya
let currentSankhyaUrl = config.sankhya.url; // Começa com a URL principal
let primaryLoginAttempts = 0;
const MAX_PRIMARY_ATTEMPTS = 2; // Tenta 2 vezes no principal antes de ir para contingência

/**
 * Garante que temos um token válido da Atualcargo.
 */
async function ensureAtualcargoToken() {
  if (!atualcargoToken) {
    logger.info('Token da Atualcargo ausente. Solicitando novo login...');
    atualcargoToken = await atualcargo.loginAtualcargo();
    
    logger.info(`Aguardando ${config.cycle.waitAfterLoginMs / 1000}s após login...`);
    await delay(config.cycle.waitAfterLoginMs);
  }
}

/**
 * Garante que temos uma sessão válida do Sankhya.
 * [MODIFICADO] Esta função agora usa 'currentSankhyaUrl' e lança erro se falhar.
 */
async function ensureSankhyaSession() {
  if (!sankhyaSessionId) {
    logger.info(`Sessão Sankhya ausente. Solicitando novo login em ${currentSankhyaUrl}...`);
    // A lógica de qual URL usar é controlada pelo loop 'startApp'.
    // Esta função agora LANÇA ERRO se o login falhar, que será pego pelo 'startApp'.
    sankhyaSessionId = await sankhya.loginSankhya(currentSankhyaUrl);
    logger.info(`Login Sankhya bem-sucedido em: ${currentSankhyaUrl}`);
    
    // Se logou no principal, zera tentativas de rede
    if (currentSankhyaUrl === config.sankhya.url) {
        primaryLoginAttempts = 0;
    }
  }
}

/**
 * ETAPA 1: Busca dados da Atualcargo (se o cache estiver vazio).
 */
async function runAtualcargoStep() {
  // Se já temos dados no cache, pulamos a busca
  if (cachedVehiclePositions) {
    logger.info('Usando posições do cache. Pulando busca na Atualcargo.');
    return;
  }
  
  logger.info('Cache de posições vazio. Buscando na Atualcargo...');
  await ensureAtualcargoToken();
  const vehiclePositions = await atualcargo.getAtualcargoPositions(atualcargoToken);

  if (!vehiclePositions || vehiclePositions.length === 0) {
    logger.info('Nenhuma posição de veículo recebida. Encerrando ciclo.');
    // Deixa o cache como nulo e o ciclo principal vai esperar 5 min.
    return;
  }

  // Salva os dados no cache para a próxima etapa
  cachedVehiclePositions = vehiclePositions;
}

/**
 * ETAPA 2: Processa e salva os dados no Sankhya (usando o cache).
 */
async function runSankhyaStep() {
  // Se o cache está vazio (porque a etapa 1 falhou ou não retornou dados),
  // não há nada para processar.
  if (!cachedVehiclePositions) {
    logger.info('Cache de posições vazio. Pulando etapa do Sankhya.');
    return;
  }
  
  logger.info(`Processando ${cachedVehiclePositions.length} posições do cache para o Sankhya...`);
  
  const plates = [...new Set(cachedVehiclePositions.map(pos => pos.plate).filter(p => p))];
  if (plates.length === 0) {
    logger.info('Nenhuma placa válida nos dados do cache. Limpando cache.');
    cachedVehiclePositions = null;
    return;
  }

  // Bloco Try/Catch focado APENAS no Sankhya
  try {
    // [MODIFICADO] ensureSankhyaSession agora pode lançar erro (de rede ou auth)
    await ensureSankhyaSession(); 

    // [MODIFICADO] Passa a 'currentSankhyaUrl' para todas as chamadas
    const vehicleMap = await sankhya.getSankhyaVehicleCodes(sankhyaSessionId, plates, currentSankhyaUrl);
    const lastTimestamps = await sankhya.getLastRecordedTimestamps(sankhyaSessionId, currentSankhyaUrl);
    
    await sankhya.savePositionsToSankhya(
      sankhyaSessionId, 
      cachedVehiclePositions, 
      vehicleMap,
      lastTimestamps,
      currentSankhyaUrl // Passa a URL
    );
    
    // [!!] SUCESSO [!!]
    logger.info('Dados salvos no Sankhya com sucesso. Limpando cache.');
    cachedVehiclePositions = null;

  } catch (error) {
    // [MODIFICADO] A lógica de alternância de URL foi movida para o 'startApp'
    // Aqui apenas limpamos o token se necessário e relançamos o erro.
    logger.error(`Falha na etapa do Sankhya: ${error.message}`);
    if (error instanceof SankhyaTokenError) {
      sankhyaSessionId = null; // Força re-login do Sankhya
    }
    // Re-lança o erro para o catch principal do startApp
    throw error;
  }
}


/**
 * Inicia o loop principal do serviço.
 */
export async function startApp() {
  logger.info('Iniciando serviço de integração de rastreamento...');
  
  while (true) {
    try {
      // ETAPA 1: Busca na Atualcargo (só executa se o cache estiver vazio)
      await runAtualcargoStep();

      // ETAPA 2: Processa no Sankhya (só executa se o cache tiver dados)
      await runSankhyaStep();
      
      logger.info('--- Ciclo de integração concluído ---');
      logger.info(`Aguardando ${config.cycle.waitBetweenCyclesMs / 1000}s para o próximo ciclo...`);
      await delay(config.cycle.waitBetweenCyclesMs);

    } catch (error) {
      // [!!] MUDANÇA AQUI: Tratamento de erros de contingência
      logger.error(`Erro grave no ciclo: ${error.message}`, error);

      // Se o erro foi na API da ATUALCARGO
      if (error instanceof AtualcargoTokenError) {
        logger.warn('Forçando re-login da Atualcargo no próximo ciclo.');
        atualcargoToken = null;
        cachedVehiclePositions = null; // Falha ao buscar, limpa o cache
      
      } else if (error instanceof SankhyaTokenError) {
        // ERRO DE AUTENTICAÇÃO SANKHYA (Acesso Negado, Token Expirado status 3)
        logger.warn(`Erro de Token/Sessão Sankhya: ${error.message}`);
        sankhyaSessionId = null; // Garante que está nulo

        // Lógica de contingência: "rodar até o login... dar acesso negado"
        if (config.sankhya.contingencyUrl && currentSankhyaUrl === config.sankhya.contingencyUrl) {
          logger.warn('Acesso negado ou token expirou na contingência. Voltando para o principal.');
          currentSankhyaUrl = config.sankhya.url;
          primaryLoginAttempts = 0;
        } else {
          // Acesso negado no principal. Apenas loga.
          logger.error('Acesso negado no principal. O ciclo tentará novamente no principal.');
        }
      
      } else {
        // ERRO GENÉRICO (Rede, Timeout, 500, etc.)
        // Pode ser da Atualcargo ou Sankhya
        logger.warn(`Erro inesperado ou de rede: ${error.message}`);
        
        // Limpa o token da Atualcargo se o erro for dela
        if (error.message.includes('Atualcargo')) {
           logger.warn('Erro de rede na Atualcargo. Limpando token e cache.');
           atualcargoToken = null;
           cachedVehiclePositions = null;
        }

        // Lógica de contingência para erros de REDE SANKHYA
        // Se o erro não for da Atualcargo (ou não pularmos por ela), assumimos Sankhya
        if (!error.message.includes('Atualcargo')) {
          logger.warn('Erro de rede no Sankhya. Iniciando lógica de contingência.');
          sankhyaSessionId = null; // Força re-login

          // Só executa lógica de alternância se a URL de contingência existir
          if (config.sankhya.contingencyUrl) {
            if (currentSankhyaUrl === config.sankhya.url) {
              // Estava no principal e falhou (rede)
              primaryLoginAttempts++;
              logger.info(`Falha de rede no principal. Tentativa ${primaryLoginAttempts}/${MAX_PRIMARY_ATTEMPTS}.`);
              
              if (primaryLoginAttempts >= MAX_PRIMARY_ATTEMPTS) {
                logger.warn('Limite de falhas no principal atingido. Alternando para contingência.');
                currentSankhyaUrl = config.sankhya.contingencyUrl;
                primaryLoginAttempts = 0;
              }
            } else {
              // Estava na contingência e falhou (rede)
              logger.warn('Falha de rede na contingência. Tentando novamente na contingência.');
              // Continua na contingência, não volta para o principal por erro de rede.
            }
          } else {
            logger.warn('Erro de rede no Sankhya, mas não há URL de contingência definida.');
          }
        } else {
          // Erro de rede da Atualcargo, limpa tudo por segurança
          atualcargoToken = null;
          sankhyaSessionId = null;
          cachedVehiclePositions = null;
        }
      }

      // Aguarda o tempo de erro (90s) antes de tentar o ciclo novamente.
      logger.info(`Aguardando ${config.cycle.waitAfterErrorMs / 1000}s antes de tentar novamente...`);
      await delay(config.cycle.waitAfterErrorMs);
    }
  }
}