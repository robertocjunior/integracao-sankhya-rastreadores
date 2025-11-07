import { config } from './config/index.js';
import logger from './utils/logger.js';
import { delay, getBaitNumber } from './utils/helpers.js';
import { SankhyaTokenError } from './utils/errors.js';
import { getAllPositions } from './services/atualcargo.service.js'; // Assumindo que este serviço existe
import {
  loginSankhya,
  getLastRecordedTimestamps,
  getSankhyaVehicleCodes,
  savePositionsToSankhya,
  getLastBaitTimestamps,
  getSankhyaBaitSequences,
  saveBaitPositionsToSankhya
} from './services/sankhya.service.js';

// Estado do Serviço
let jsessionid = null;
let currentSankhyaUrl = config.sankhya.primaryUrl; // Começa com a URL primária

const BAIT_PREFIX = 'ISCA';

/**
 * Tenta login no Sankhya (primário ou contingência) e atualiza o estado.
 */
async function handleLogin() {
  logger.info(`Tentando login em ${currentSankhyaUrl}`);
  try {
    jsessionid = await loginSankhya(currentSankhyaUrl);
    logger.info('Login realizado com sucesso.');
  } catch (error) {
    if (error instanceof SankhyaTokenError) {
      throw error; // Se a autenticação falhar (ex: senha errada), não adianta tentar a outra URL.
    }

    // Se o erro não for de autenticação (ex: timeout, conexão recusada)
    logger.warn(`Falha ao logar em ${currentSankhyaUrl}. Tentando URL de contingência.`);
    
    // Troca para a URL de contingência
    currentSankhyaUrl = (currentSankhyaUrl === config.sankhya.primaryUrl)
      ? config.sankhya.contingencyUrl
      : config.sankhya.primaryUrl;
    
    // Tenta logar na URL de contingência
    jsessionid = await loginSankhya(currentSankhyaUrl);
    logger.info('Login realizado com sucesso na URL de contingência.');
  }
}

/**
 * Separa a lista de posições da API entre veículos e iscas.
 * @param {Array<Object>} allPositions - Lista de todas as posições da Atualcargo.
 * @returns {{vehiclePositions: Array<Object>, baitPositions: Array<Object>}}
 */
function separatePositions(allPositions) {
  const vehiclePositions = [];
  const baitPositions = [];

  if (!allPositions || allPositions.length === 0) {
    logger.warn('API Atualcargo não retornou posições.');
    return { vehiclePositions, baitPositions };
  }

  for (const pos of allPositions) {
    if (pos.plate && pos.plate.toUpperCase().startsWith(BAIT_PREFIX)) {
      baitPositions.push(pos);
    } else {
      vehiclePositions.push(pos);
    }
  }

  logger.info(`Posições separadas: ${vehiclePositions.length} veículos, ${baitPositions.length} iscas.`);
  return { vehiclePositions, baitPositions };
}

/**
 * Processa o fluxo completo para Veículos (AD_LOCATCAR).
 * @param {string} sessionId - JSessionID
 * @param {string} baseUrl - URL do Sankhya
 * @param {Array<Object>} positions - Lista de posições de veículos
 */
async function processVehicles(sessionId, baseUrl, positions) {
  if (positions.length === 0) {
    logger.info('[Veículos] Nenhuma posição de veículo para processar.');
    return;
  }

  try {
    // 1. Extrair placas únicas
    const plates = [...new Set(positions.map(p => p.plate).filter(Boolean))];
    if (plates.length === 0) {
      logger.warn('[Veículos] Posições de veículos recebidas, mas sem placas válidas.');
      return;
    }

    // 2. Buscar códigos dos veículos no Sankhya
    const vehicleMap = await getSankhyaVehicleCodes(sessionId, plates, baseUrl);

    // 3. Buscar últimos timestamps salvos
    const lastTimestampsMap = await getLastRecordedTimestamps(sessionId, baseUrl);

    // 4. Salvar novas posições
    await savePositionsToSankhya(sessionId, positions, vehicleMap, lastTimestampsMap, baseUrl);

  } catch (error) {
    logger.error(`[Veículos] Erro no processamento: ${error.message}`);
    if (error instanceof SankhyaTokenError) throw error; // Repassa erro de sessão
  }
}

/**
 * Processa o fluxo completo para Iscas (AD_LOCATISC).
 * @param {string} sessionId - JSessionID
 * @param {string} baseUrl - URL do Sankhya
 * @param {Array<Object>} positions - Lista de posições de iscas
 */
async function processBaits(sessionId, baseUrl, positions) {
  if (positions.length === 0) {
    logger.info('[Iscas] Nenhuma posição de isca para processar.');
    return;
  }

  try {
    // 1. Extrair números de isca únicos
    const baitNumbers = [...new Set(positions.map(p => getBaitNumber(p.plate)).filter(Boolean))];
    if (baitNumbers.length === 0) {
      logger.warn('[Iscas] Posições de iscas recebidas, mas sem números válidos (ex: ISCA1234).');
      return;
    }

    // 2. Buscar SEQUENCIAS das iscas no Sankhya (AD_CADISCA)
    const baitMap = await getSankhyaBaitSequences(sessionId, baitNumbers, baseUrl);

    // 3. Buscar últimos timestamps salvos (AD_LOCATISC)
    const lastTimestampsMap = await getLastBaitTimestamps(sessionId, baseUrl);

    // 4. Salvar novas posições (AD_LOCATISC)
    await saveBaitPositionsToSankhya(sessionId, positions, baitMap, lastTimestampsMap, baseUrl);

  } catch (error) {
    logger.error(`[Iscas] Erro no processamento: ${error.message}`);
    if (error instanceof SankhyaTokenError) throw error; // Repassa erro de sessão
  }
}


async function mainServiceLoop() {
  logger.info('Iniciando ciclo do serviço...');
  
  try {
    // 1. Garantir Login no Sankhya
    if (!jsessionid) {
      await handleLogin();
    }

    // 2. Buscar dados da API Externa (Atualcargo)
    // Se falhar, o ciclo é interrompido e tenta novamente após o delay
    const allPositions = await getAllPositions();

    // 3. Separar posições (Veículos vs Iscas)
    const { vehiclePositions, baitPositions } = separatePositions(allPositions);

    // 4. Processar ambos os fluxos (Veículos e Iscas)
    // Usamos Promise.all para que, se um falhar (ex: erro de sessão), o outro também pare
    // e o erro seja pego pelo catch principal.
    await Promise.all([
      processVehicles(jsessionid, currentSankhyaUrl, vehiclePositions),
      processBaits(jsessionid, currentSankhyaUrl, baitPositions)
    ]);

  } catch (error) {
    if (error instanceof SankhyaTokenError) {
      logger.warn(`Sessão Sankhya expirada ou inválida: ${error.message}. Tentando novo login no próximo ciclo.`);
      jsessionid = null; // Força novo login
    } else {
      // Erros críticos (ex: falha na API Atualcargo, erros inesperados)
      logger.error(`Erro crítico no ciclo: ${error.message}`, error);
      // Aqui, podemos decidir se devemos parar o serviço ou apenas tentar novamente.
      // Por enquanto, apenas registramos e o loop continuará.
    }
  }

  // 5. Aguardar o próximo ciclo
  const interval = config.service.intervalSeconds * 1000;
  logger.info(`Ciclo concluído. Aguardando ${config.service.intervalSeconds} segundos...`);
  await delay(interval);
}

/**
 * Inicia o serviço.
 */
export async function startService() {
  logger.info('Serviço de Sincronização Atualcargo-Sankhya iniciado.');
  while (true) {
    await mainServiceLoop();
  }
}