import axios from 'axios';
import { config } from '../config/index.js';
import logger from '../utils/logger.js';
import { SankhyaTokenError } from '../utils/errors.js';
import { 
  formatSankhyaDate, 
  parseAtualcargoDate, 
  parseSankhyaQueryDate 
} from '../utils/helpers.js';

// [MODIFICADO] Apenas 'username' e 'password' são globais
const { username, password } = config.sankhya;

// [NOVO] Função helper para construir a URL da API
const getSankhyaApiUrl = (baseUrl) => `${baseUrl}/service.sbr`;

/**
 * Realiza login no Sankhya MGE.
 * @param {string} baseUrl - A URL base (principal ou contingência)
 * @returns {Promise<string>} O JSessionID
 */
export async function loginSankhya(baseUrl) {
  logger.info(`Tentando login no Sankhya em ${baseUrl}...`);
  const SANKHYA_API_URL = getSankhyaApiUrl(baseUrl);

  try {
    const response = await axios.post(
      `${SANKHYA_API_URL}?serviceName=MobileLoginSP.login&outputType=json`,
      {
        serviceName: 'MobileLoginSP.login',
        requestBody: {
          NOMUSU: { $: username },
          INTERNO: { $: password },
          KEEPCONNECTED: { $: 'S' },
        },
      }
    );

    if (response.data?.status === '1' && response.data.responseBody?.jsessionid?.$) {
      logger.info('Login no Sankhya bem-sucedido.');
      return response.data.responseBody.jsessionid.$;
    }

    // [MODIFICADO] Lança erro de token se o status for '0' (ex: Acesso Negado)
    if (response.data?.status === '0') {
      logger.error(`Falha de autenticação no Sankhya: ${response.data.statusMessage}`, response.data);
      throw new SankhyaTokenError(`Falha de autenticação no Sankhya: ${response.data.statusMessage}`);
    }
    
    logger.error('Falha no login do Sankhya: jsessionid não encontrado.', response.data);
    throw new Error('jsessionid não retornado pelo Sankhya');

  } catch (error) {
    // Repassa o SankhyaTokenError
    if (error instanceof SankhyaTokenError) throw error;
    
    // Erros de rede (timeout, etc) são lançados como Erro genérico
    logger.error(`Erro crítico ao fazer login no Sankhya: ${error.message}`);
    throw new Error(`Falha no login da Sankhya: ${error.message}`);
  }
}

/**
 * @param {string} sessionId - O JSessionID
 * @returns {Object} Configuração de headers padrão para o Sankhya
 */
const getSankhyaHeaders = (sessionId) => ({
  'Cookie': `JSESSIONID=${sessionId}`,
  'Content-Type': 'application/json',
});

/**
 * Busca o último timestamp (DATHOR) de cada veículo já salvo no Sankhya.
 * @param {string} sessionId - O JSessionID
 * @param {string} baseUrl - A URL base (principal ou contingência)
 * @returns {Promise<Map<number, Date>>} Um Map<CODVEICULO, Objeto Date>
 */
export async function getLastRecordedTimestamps(sessionId, baseUrl) {
  logger.info('Buscando últimos registros de DATHOR no Sankhya...');
  const sql = "WITH UltimoRegistro AS (SELECT CODVEICULO, DATHOR, PLACA, ROW_NUMBER() OVER (PARTITION BY CODVEICULO ORDER BY NUMREG DESC) AS RN FROM AD_LOCATCAR) SELECT CODVEICULO, DATHOR, PLACA FROM UltimoRegistro WHERE RN = 1";
  const SANKHYA_API_URL = getSankhyaApiUrl(baseUrl);

  try {
    const response = await axios.post(
      `${SANKHYA_API_URL}?serviceName=DbExplorerSP.executeQuery&outputType=json`,
      {
        serviceName: 'DbExplorerSP.executeQuery',
        requestBody: { sql, params: {} },
      },
      { headers: getSankhyaHeaders(sessionId) }
    );

    if (response.data?.status === '1') {
      const timestampMap = new Map();
      for (const row of response.data.responseBody.rows) {
        const codveiculo = row[0];
        const dathorStr = row[1]; // Formato "03112025 14:01:00"
        
        if (codveiculo && dathorStr) {
          const parsedDate = parseSankhyaQueryDate(dathorStr);
          if (parsedDate) {
            timestampMap.set(codveiculo, parsedDate);
          }
        }
      }
      logger.info(`Encontrados ${timestampMap.size} últimos registros de timestamp.`);
      return timestampMap;
    } else if (response.data?.status === '3') {
      logger.warn(`Sessão Sankhya expirou (status: 3): ${response.data.statusMessage}`);
      throw new SankhyaTokenError('Sessão Sankhya expirada (status 3).');
    } else {
      logger.error('Erro ao buscar últimos timestamps no Sankhya:', response.data);
      throw new Error(`Falha na query Sankhya: ${response.data.statusMessage || 'Erro desconhecido'}`);
    }

  } catch (error) {
    if (error instanceof SankhyaTokenError) throw error;
    logger.error(`Erro ao buscar timestamps no Sankhya: ${error.message}`);
    throw new Error(`Falha ao buscar timestamps no Sankhya: ${error.message}`);
  }
}


/**
 * Busca os CODVEICULO no Sankhya com base em uma lista de placas.
 * @param {string} sessionId - O JSessionID
 * @param {Array<string>} plates - Lista de placas
 * @param {string} baseUrl - A URL base (principal ou contingência)
 * @returns {Promise<Map<string, number>>} Um Map<placa, codveiculo>
 */
export async function getSankhyaVehicleCodes(sessionId, plates, baseUrl) {
  if (!plates || plates.length === 0) {
    return new Map();
  }

  const platesInClause = plates.map(p => `'${p}'`).join(',');
  const sql = `SELECT VEI.CODVEICULO, VEI.PLACA FROM TGFVEI VEI WHERE VEI.PLACA IN (${platesInClause})`;
  const SANKHYA_API_URL = getSankhyaApiUrl(baseUrl);

  logger.info(`Buscando CODVEICULO para ${plates.length} placas...`);

  try {
    const response = await axios.post(
      `${SANKHYA_API_URL}?serviceName=DbExplorerSP.executeQuery&outputType=json`,
      {
        serviceName: 'DbExplorerSP.executeQuery',
        requestBody: { sql, params: {} },
      },
      { headers: getSankhyaHeaders(sessionId) }
    );

    if (response.data?.status === '1') {
      const vehicleMap = new Map();
      for (const row of response.data.responseBody.rows) {
        const codveiculo = row[0];
        const placa = row[1];
        vehicleMap.set(placa, codveiculo);
      }
      logger.info(`Encontrados ${vehicleMap.size} veículos correspondentes no Sankhya.`);
      return vehicleMap;
    } else if (response.data?.status === '3') {
      logger.warn(`Sessão Sankhya expirou (status: 3): ${response.data.statusMessage}`);
      throw new SankhyaTokenError('Sessão Sankhya expirada (status 3).');
    } else {
      logger.error('Erro ao executar query no Sankhya:', response.data);
      throw new Error(`Falha na query Sankhya: ${response.data.statusMessage || 'Erro desconhecido'}`);
    }

  } catch (error) {
    if (error instanceof SankhyaTokenError) throw error;
    logger.error(`Erro ao buscar veículos no Sankhya: ${error.message}`);
    throw new Error(`Falha ao buscar veículos no Sankhya: ${error.message}`);
  }
}

/**
 * Salva (atualiza/insere) as posições na tabela AD_LOCATCAR do Sankhya.
 * @param {string} sessionId - O JSessionID
 * @param {Array<Object>} vehiclePositions - Lista de posições da Atualcargo
 * @param {Map<string, number>} vehicleMap - Map<placa, codveiculo>
 * @param {Map<number, Date>} lastTimestampsMap - Map<CODVEICULO, Objeto Date>
 * @param {string} baseUrl - A URL base (principal ou contingência)
 */
export async function savePositionsToSankhya(sessionId, vehiclePositions, vehicleMap, lastTimestampsMap, baseUrl) {
  const recordsToSave = [];
  let processedCount = 0;
  let ignoredCount = 0;
  let invalidDateCount = 0;
  let unmappedCount = 0;

  for (const pos of vehiclePositions) {
    const codveiculo = vehicleMap.get(pos.plate);

    if (codveiculo) {
      processedCount++;
      const lastSavedDate = lastTimestampsMap.get(codveiculo);
      const newPositionDate = parseAtualcargoDate(pos.date);

      if (!newPositionDate) {
        logger.warn(`Placa ${pos.plate} (COD ${codveiculo}) tem data da API inválida: ${pos.date}`);
        invalidDateCount++;
        continue; 
      }
      
      if (!lastSavedDate || newPositionDate.getTime() > lastSavedDate.getTime()) {
        const latitude = pos.latlong.latitude.toString();
        const longitude = pos.latlong.longitude.toString();
        const local = pos.proximity || `${pos.address?.street}, ${pos.address?.city}` || 'Endereço não disponível';
        const dataFormatada = formatSankhyaDate(pos.date);
        const link = `https://www.google.com/maps?q=${latitude},${longitude}`;
        const ignitSankhya = (pos.ignition === 'ON') ? 'S' : 'N';

        recordsToSave.push({
          foreignKey: {
            CODVEICULO: codveiculo.toString(),
          },
          values: {
            '2': local,
            '3': dataFormatada,
            '4': pos.plate,
            '5': latitude,
            '6': longitude,
            '7': pos.speed.toString(),
            '8': link,
            '9': ignitSankhya,
          },
        });
      } else {
        ignoredCount++;
      }
    } else {
      unmappedCount++;
    }
  }

  logger.info(`Posições recebidas: ${vehiclePositions.length}. Correspondentes no Sankhya: ${processedCount}.`);
  if (unmappedCount > 0) logger.warn(`${unmappedCount} placas recebidas não foram encontradas no Sankhya.`);
  if (invalidDateCount > 0) logger.warn(`${invalidDateCount} registros com data inválida.`);


  if (recordsToSave.length === 0) {
    logger.info(`Nenhum registro novo para salvar. Total de registros ignorados (por data): ${ignoredCount}.`);
    return;
  }

  logger.info(`Preparando para salvar ${recordsToSave.length} novos registros...`);
  const SANKHYA_API_URL = getSankhyaApiUrl(baseUrl);

  const payload = {
    serviceName: 'DatasetSP.save',
    requestBody: {
      dataSetID: '01S',
      entityName: 'AD_LOCATCAR',
      standAlone: false,
      fields: [
        'NUMREG', 'CODVEICULO', 'LOCAL', 'DATHOR', 'PLACA',
        'LATITUDE', 'LONGITUDE', 'VELOC', 'LINK', 'IGNIT'
      ],
      records: recordsToSave,
    },
  };

  try {
    const response = await axios.post(
      `${SANKHYA_API_URL}?serviceName=DatasetSP.save&outputType=json`,
      payload,
      { headers: getSankhyaHeaders(sessionId) }
    );

    if (response.data?.status === '1') {
      logger.info(`Resumo da gravação: ${recordsToSave.length} registros salvos, ${ignoredCount} registros ignorados (por data).`);
    } else if (response.data?.status === '3') {
      logger.warn(`Sessão Sankhya expirou (status: 3) ao salvar: ${response.data.statusMessage}`);
      throw new SankhyaTokenError('Sessão Sankhya expirada (status 3).');
    } else {
      logger.error('Falha ao salvar registros no Sankhya:', response.data);
      throw new Error(`Falha ao salvar no Sankhya: ${response.data.statusMessage || 'Erro desconhecido'}`);
    }
  } catch (error) {
    if (error instanceof SankhyaTokenError) throw error;
    logger.error(`Erro ao salvar no Sankhya: ${error.message}`);
    throw new Error(`Falha ao salvar no Sankhya: ${error.message}`);
  }
}