import logger, { createLogger } from '../utils/logger.js';
import { delay } from '../utils/dateTime.js';
import { appConfig, sankhyaConfig } from '../config/index.js';
import statusManager from '../utils/statusManager.js'; // IMPORTA O STATUS MANAGER

/**
 * Cria e gerencia um loop de job seguro (setTimeout recursivo).
 * @param {string} name - Nome do Job (para logs)
 * @param {Function} jobFunction - A função async 'run' do job
 * @param {number} intervalMs - O intervalo em milissegundos
 */
export function createJobLoop(name, jobFunction, intervalMs) {
  logger.info(
    `[JobScheduler] Agendando job [${name}] para rodar a cada ${intervalMs / 60000} minutos.`
  );
  
  // Seta o status inicial como 'idle' e agenda a primeira execução
  const firstRunTimestamp = Date.now() + 1000; // 1 segundo a partir de agora
  statusManager.updateJobStatus(name, 'idle', 'Aguardando primeira execução...', firstRunTimestamp);

  const loop = async () => {
    logger.info(`--- [Iniciando Job: ${name}] ---`);
    try {
      // ATUALIZADO: Limpa o timer 'nextRun' e seta o status para 'running'
      statusManager.updateJobStatus(name, 'running', 'Iniciando...', null);
      await jobFunction();
    } catch (error) {
      logger.error(
        `[Job: ${name}] Erro fatal não tratado no loop: ${error.message}`,
        { stack: error.stack }
      );
      // Se o job falhar, ele mesmo deve setar o status de erro no statusManager
    } finally {
      const nextRunMin = intervalMs / 60000;
      logger.info(`[Job: ${name}] Ciclo finalizado. Próxima execução em ${nextRunMin} min.`);
      logger.info(`-----------------------------------`);
      
      // --- NOVO CÓDIGO ---
      // Pega o status atual (que foi definido pelo job, ex: 'idle' ou 'error')
      const jobKey = name.toLowerCase();
      const currentStatus = statusManager.getStatus()[jobKey] || { status: 'idle', message: 'Ciclo concluído.' };
      
      // Calcula o timestamp exato da próxima execução
      const nextRunTimestamp = Date.now() + intervalMs;
      
      // Atualiza o status com a data da próxima execução
      statusManager.updateJobStatus(
          name, 
          currentStatus.status, 
          currentStatus.message, 
          nextRunTimestamp // Passa o novo timestamp
      );
      // --- FIM DO NOVO CÓDIGO ---
      
      // Agenda a próxima execução
      setTimeout(loop, intervalMs);
    }
  };

  // Inicia o primeiro ciclo (agora com o delay inicial)
  setTimeout(loop, 1000);
}


/**
 * Cria um gerenciador de estado para um job (cache, URL Sankhya).
 * @param {string} sourceName - Nome do Job (ex: 'Atualcargo')
 * @param {Object} config - Configurações (sankhyaConfig, appConfig)
 */
export function createJobStateManager(sourceName, config) {
  const logger = createLogger(`Job:${sourceName}`);
  
  return {
    cache: null,
    sankhyaUrl: config.sankhya.url, // URL principal
    primaryLoginAttempts: 0,
    
    setCache(data) {
      this.cache = data;
    },
    
    getCache() {
      return this.cache;
    },
    
    clearCache() {
      this.cache = null;
    },
    
    // Lógica de falha e troca de URL do Sankhya
    handleSankhyaError(error) {
      logger.warn(`Erro de rede no Sankhya: ${error.message}. Iniciando lógica de contingência.`);

      if (config.sankhya.contingencyUrl) {
          if (this.sankhyaUrl === config.sankhya.url) {
              this.primaryLoginAttempts++;
              logger.info(`Falha de rede no principal. Tentativa ${this.primaryLoginAttempts}/${config.app.sankhyaRetryLimit}.`);
              
              if (this.primaryLoginAttempts >= config.app.sankhyaRetryLimit) {
                  logger.warn('Limite de falhas no principal atingido. Alternando para contingência.');
                  this.sankhyaUrl = config.sankhya.contingencyUrl;
                  this.primaryLoginAttempts = 0;
              }
          } else {
              logger.warn('Falha de rede na contingência. Voltando para o principal.');
              this.sankhyaUrl = config.sankhya.url; // Volta para o principal
              this.primaryLoginAttempts = 0;
          }
      } else {
          logger.warn('Erro de rede no Sankhya, mas não há URL de contingência definida.');
      }
    },
    
    // Reseta tentativas se o login na URL principal for bem-sucedido
    handleSankhyaSuccess() {
        if (this.sankhyaUrl === config.sankhya.url) {
            this.primaryLoginAttempts = 0;
        }
    }
  };
}