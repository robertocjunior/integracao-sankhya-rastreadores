import axios from 'axios';
import { sankhyaConfig, appConfig } from '../config/index.js';
import { createLogger } from '../utils/logger.js';
import { SankhyaTokenError } from '../utils/errors.js';
import { 
  formatForSankhyaInsert,
  parseSitraxDate,
  parseSankhyaQueryDate 
} from '../utils/dateTime.js';
import { TextDecoder } from 'util';

const logger = createLogger('SankhyaAPI');

// --- Gerenciador da Instância do Axios ---
let apiClient = createApiClient(sankhyaConfig.url);

function createApiClient(baseUrl) {
  return axios.create({
    baseURL: baseUrl,
    timeout: appConfig.timeout,
    responseType: 'arraybuffer',
    transformResponse: [data => {
      try {
        const decoder = new TextDecoder('iso-8859-1');
        const decoded = decoder.decode(data);
        return JSON.parse(decoded);
      } catch (e) {
        return data; // Retorna buffer se falhar
      }
    }],
  });
}

// --- Gerenciamento de Sessão ---
let jsessionid = null;
let loginPromise = null;

async function performLogin(baseUrl) {
  logger.info(`[Sankhya] Autenticando (iniciando nova sessão) em ${baseUrl}...`);
  apiClient = createApiClient(baseUrl);
  
  try {
    const loginBody = {
      serviceName: 'MobileLoginSP.login',
      requestBody: {
        NOMUSU: { $: sankhyaConfig.username },
        INTERNO: { $: sankhyaConfig.password },
        KEEPCONNECTED: { $: 'S' },
      },
    };
    
    const response = await axios.post(
      '/service.sbr?serviceName=MobileLoginSP.login&outputType=json',
      loginBody,
      {
        baseURL: apiClient.defaults.baseURL,
        timeout: apiClient.defaults.timeout,
        responseType: 'json' 
      }
    );

    const data = response.data;
    if (data.status === '1' && data.responseBody?.jsessionid?.$) {
      jsessionid = data.responseBody.jsessionid.$;
      logger.info(`[Sankhya] Login bem-sucedido. JSessionID: ${jsessionid.substring(0, 10)}...`);
    } else {
      logger.error(`[Sankhya] Falha de autenticação: ${data.statusMessage}`, data);
      throw new SankhyaTokenError(`Falha de autenticação no Sankhya: ${data.statusMessage}`);
    }
  } catch (error) {
    if (error instanceof SankhyaTokenError) throw error;
    logger.error(`[Sankhya] Erro crítico ao fazer login: ${error.message}`);
    jsessionid = null;
    throw new Error(`Falha no login da Sankhya: ${error.message}`);
  } finally {
    loginPromise = null;
  }
}

async function login(baseUrl) {
  if (jsessionid && !loginPromise) {
    return;
  }
  if (loginPromise) {
    logger.debug('[Sankhya] Aguardando login em andamento...');
    return loginPromise;
  }
  loginPromise = performLogin(baseUrl);
  return loginPromise;
}

async function makeRequest(serviceName, requestBody, baseUrl) {
  if (!jsessionid) {
      await login(baseUrl);
  }

  const url = `/service.sbr?serviceName=${serviceName}&outputType=json`;
  const body = { serviceName, requestBody };
  const headers = {
    'Cookie': `JSESSIONID=${jsessionid}`,
  };

  try {
    const response = await apiClient.post(url, body, { headers });
    
    if (response.data.status === '1') {
      return response.data.responseBody;
    }
    
    if (response.data.status === '3' && response.data.statusMessage === 'Não autorizado.') {
      logger.warn('[Sankhya] JSessionID expirado ou inválido (Não autorizado). Reautenticando...');
      jsessionid = null;
      await login(baseUrl); 
      
      const newHeaders = { Cookie: `JSESSIONID=${jsessionid}` };
      const retryResponse = await apiClient.post(url, body, { headers: newHeaders });

      if (retryResponse.data.status === '1') {
        return retryResponse.data.responseBody;
      }
      throw new Error(`Falha na requisição Sankhya (${serviceName}) após re-autenticar: ${retryResponse.data.statusMessage}`);
    }
    
    throw new Error(`Erro na requisição Sankhya (${serviceName}): ${response.data.statusMessage || 'Erro desconhecido'}`);

  } catch (error) {
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT' || error.response?.status === 504) {
      logger.error('[Sankhya] Timeout na requisição.');
      throw new Error(`Timeout da API Sankhya: ${serviceName}`);
    }
    logger.error(`[Sankhya] Falha na chamada de serviço (${serviceName}): ${error.message}`);
    if (error instanceof SankhyaTokenError) throw error;
    if (error.message.includes('connect') || error.message.includes('Timeout')) {
        jsessionid = null;
    }
    throw error;
  }
}

function formatQueryResponse(responseBody) {
  const fields = responseBody.fieldsMetadata?.map((f) => f.name) || [];
  const rows = responseBody.rows || [];
  
  return rows.map((row) => {
    const obj = {};
    fields.forEach((field, index) => {
      obj[field] = row[index];
    });
    return obj;
  });
}

// --- Funções de Consulta ---

export async function getVehiclesByPlate(plates, baseUrl) {
  if (!plates || plates.length === 0) return [];
  logger.info(`[Sankhya] Consultando CODVEICULO para ${plates.length} placas...`);
  
  const inClause = plates.map((p) => `'${p.trim()}'`).join(',');
  const sql = `SELECT VEI.CODVEICULO, VEI.PLACA FROM TGFVEI VEI WHERE VEI.PLACA IN (${inClause})`;

  const responseBody = await makeRequest('DbExplorerSP.executeQuery', { sql, params: {} }, baseUrl);
  return formatQueryResponse(responseBody);
}

export async function getIscasByNum(iscaNumbers, fabricanteId, baseUrl) {
  if (!iscaNumbers || iscaNumbers.length === 0) return [];
  logger.info(`[Sankhya] Consultando SEQUENCIA para ${iscaNumbers.length} iscas (Fabr: ${fabricanteId})...`);

  const inClause = iscaNumbers.map((n) => `'${n.trim()}'`).join(',');
  const sql = `SELECT SEQUENCIA, NUMISCA FROM AD_CADISCA SCA WHERE SCA.NUMISCA IN (${inClause}) AND SCA.FABRICANTE = ${fabricanteId} AND SCA.ATIVO = 'S'`;

  const responseBody = await makeRequest('DbExplorerSP.executeQuery', { sql, params: {} }, baseUrl);
  return formatQueryResponse(responseBody);
}

export async function getLastVehicleHistory(baseUrl) {
  logger.debug('[Sankhya] Consultando último histórico de veículos (AD_LOCATCAR)...');
  const sql = "WITH UltimoRegistro AS (SELECT CODVEICULO, DATHOR, PLACA, ROW_NUMBER() OVER (PARTITION BY CODVEICULO ORDER BY NUMREG DESC) AS RN FROM AD_LOCATCAR) SELECT CODVEICULO, DATHOR, PLACA FROM UltimoRegistro WHERE RN = 1";
  
  const responseBody = await makeRequest('DbExplorerSP.executeQuery', { sql, params: {} }, baseUrl);
  return formatQueryResponse(responseBody);
}

export async function getLastIscaHistory(baseUrl) {
  logger.debug('[Sankhya] Consultando último histórico de iscas (AD_LOCATISC)...');
  const sql = "WITH UltimoRegistro AS (SELECT SEQUENCIA, DATHOR, ISCA, ROW_NUMBER() OVER (PARTITION BY SEQUENCIA ORDER BY NUMREG DESC) AS RN FROM AD_LOCATISC) SELECT SEQUENCIA, DATHOR, ISCA FROM UltimoRegistro WHERE RN = 1";
  
  const responseBody = await makeRequest('DbExplorerSP.executeQuery', { sql, params: {} }, baseUrl);
  return formatQueryResponse(responseBody);
}

// --- Funções de Inserção ---

export async function insertVehicleHistory(records, baseUrl) {
  if (records.length === 0) {
    logger.debug('[Sankhya] Nenhum registro novo para AD_LOCATCAR.');
    return;
  }
  logger.info(`[Sankhya] Inserindo ${records.length} novos registros em AD_LOCATCAR...`);

  const formattedRecords = records.map(r => {
    const dathorStr = formatForSankhyaInsert(r.date);
    // ***** ESTA É A CORREÇÃO (LINK) *****
    const link = `http://googleusercontent.com/maps/google.com/3${r.lat},${r.lon}`;

    return {
      foreignKey: {
        CODVEICULO: r.codveiculo.toString(),
      },
      values: {
        "2": r.location,
        "3": dathorStr,
        "4": r.insertValue,
        "5": r.lat.toString(),
        "6": r.lon.toString(),
        "7": r.speed.toString(),
        "8": link,
        "9": r.ignition,
      },
    };
  });

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
      records: formattedRecords,
    },
  };

  await makeRequest('DatasetSP.save', payload.requestBody, baseUrl);
  logger.info(`[Sankhya] Inserção em AD_LOCATCAR concluída.`);
}

export async function insertIscaHistory(records, baseUrl) {
  if (records.length === 0) {
    logger.debug('[Sankhya] Nenhum registro novo para AD_LOCATISC.');
    return;
  }
  logger.info(`[Sankhya] Inserindo ${records.length} novos registros em AD_LOCATISC...`);

  const formattedRecords = records.map(r => {
    const dathorStr = formatForSankhyaInsert(r.date);
    // ***** ESTA É A CORREÇÃO (LINK) *****
    const link = `http://googleusercontent.com/maps/google.com/3${r.lat},${r.lon}`;
    
    return {
      foreignKey: {
        SEQUENCIA: r.sequencia.toString(),
      },
      values: {
        "2": r.location,
        "3": dathorStr,
        "4": r.insertValue,
        "5": r.lat.toString(),
        "6": r.lon.toString(),
        "7": r.speed.toString(),
        "8": link,
      },
    };
  });
  
  const payload = {
    serviceName: 'DatasetSP.save',
    requestBody: {
      dataSetID: sankhyaConfig.iscaDatasetId,
      entityName: 'AD_LOCATISC',
      standAlone: false,
      fields: [
        'NUMREG', 'SEQUENCIA', 'LOCAL', 'DATHOR', 'ISCA',
        'LATITUDE', 'LONGITUDE', 'VELOC', 'LINK'
      ],
      records: formattedRecords,
    },
  };
  
  await makeRequest('DatasetSP.save', payload.requestBody, baseUrl);
  logger.info(`[Sankhya] Inserção em AD_LOCATISC concluída.`);
}