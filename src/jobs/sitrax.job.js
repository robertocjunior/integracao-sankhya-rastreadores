import { createLogger } from '../utils/logger.js';
import { jobsConfig, sankhyaConfig, appConfig } from '../config/index.js';
import { delay } from '../utils/dateTime.js';
import { SankhyaTokenError } from '../utils/errors.js';
import { createJobStateManager } from './job.scheduler.js';
import statusManager from '../utils/statusManager.js'; 

import * as sitraxApi from '../connectors/sitrax.connector.js';
import * as sankhyaProcessor from '../sankhya/sankhya.processor.js';
import { mapSitraxToStandard } from '../sankhya/sankhya.mapper.js';

const config = jobsConfig.sitrax;
const JOB_NAME = 'Sitrax';
const logger = createLogger(`Job:${JOB_NAME}`);

const state = createJobStateManager(JOB_NAME, { sankhya: sankhyaConfig, app: appConfig });

export async function run() {
  try {
    // ETAPA 1: EXTRACT (Sitrax)
    if (!state.getCache()) {
      statusManager.updateJobStatus(JOB_NAME, 'running', 'Cache vazio. Buscando na API...');
      logger.info('Cache de posições vazio. Buscando na API...');
      const positions = await sitraxApi.getSitraxPositions();
      
      if (!positions || positions.length === 0) {
        statusManager.updateJobStatus(JOB_NAME, 'idle', 'Nenhuma posição recebida.');
        logger.info('Nenhuma posição de isca recebida. Encerrando ciclo.');
        return;
      }

      const standardData = mapSitraxToStandard(positions);
      state.setCache(standardData);
      statusManager.updateJobStatus(JOB_NAME, 'running', `${standardData.length} posições salvas no cache.`);
      logger.info(`Dados salvos no cache: ${standardData.length} posições.`);
    } else {
      statusManager.updateJobStatus(JOB_NAME, 'running', 'Usando dados do cache (retentativa).');
      logger.info('Usando posições do cache. Pulando busca na API.');
    }

    // ETAPA 2: LOAD (Sankhya)
    const cachedData = state.getCache();
    if (!cachedData || cachedData.length === 0) {
      statusManager.updateJobStatus(JOB_NAME, 'idle', 'Cache vazio.');
      logger.info('Cache de posições vazio. Pulando etapa do Sankhya.');
      return;
    }
    
    statusManager.updateJobStatus(JOB_NAME, 'running', `Processando ${cachedData.length} posições no Sankhya...`);
    await sankhyaProcessor.processPositions(
      cachedData,
      JOB_NAME,
      state.sankhyaUrl,
      config.fabricanteId
    );
    
    state.handleSankhyaSuccess();
    state.clearCache(); 
    statusManager.updateJobStatus(JOB_NAME, 'idle', 'Ciclo concluído com sucesso.'); // Seta o status final

  } catch (error) {
    logger.error(`Erro no ciclo [${JOB_NAME}]: ${error.message}`);
    statusManager.updateJobStatus(JOB_NAME, 'error', error.message); // Seta o status de erro

    if (error instanceof SankhyaTokenError) {
      logger.warn(`Erro de Token/Sessão Sankhya. O job tentará novamente com os mesmos dados.`);
    
    } else if (error.message.includes('Sitrax')) {
        logger.warn('Erro de rede na Sitrax. Limpando cache.');
        state.clearCache();
    
    } else {
      state.handleSankhyaError(error);
    }

    logger.info(`Aguardando ${appConfig.jobRetryDelayMs / 1000}s antes de tentar o job novamente...`);
    await delay(appConfig.jobRetryDelayMs);
  }
}