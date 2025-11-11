import { createLogger } from './logger.js';
const logger = createLogger('StatusManager');

/**
 * Este é um singleton para gerenciar o estado de todos os jobs
 * e transmitir para o painel web.
 */
class StatusManager {
  constructor() {
    this.io = null;
    this.status = {};
    logger.info('StatusManager inicializado.');
  }

  /**
   * Armazena a instância do servidor Socket.io.
   * Chamado pelo index.js na inicialização.
   * @param {object} ioServer - A instância do Socket.io
   */
  init(ioServer) {
    this.io = ioServer;
    logger.info('Socket.io conectado ao StatusManager.');
  }

  /**
   * Atualiza o status de um job específico.
   * @param {string} jobName - O nome do job (ex: 'Atualcargo')
   * @param {'idle' | 'running' | 'error'} status - O novo estado
   * @param {string} message - A mensagem de status
   * @param {number | null} [nextRunTimestamp] - O timestamp (Date.now() + interval) da próxima execução
   */
  updateJobStatus(jobName, status, message, nextRunTimestamp = null) {
    const jobKey = jobName.toLowerCase();
    
    // Se o status não for 'idle', limpa o timer anterior
    const clearNextRun = status !== 'idle';

    this.status[jobKey] = {
      name: jobName,
      status: status,
      message: message,
      lastUpdate: new Date().toISOString(),
      // NOVO: Adiciona o timestamp da próxima execução
      // Se o status não for 'idle', seta como nulo para parar o timer
      nextRun: clearNextRun ? null : nextRunTimestamp, 
    };
    
    // Envia a atualização para todos os clientes (navegadores) conectados
    if (this.io) {
      this.io.emit('status-update', this.status);
    }
  }

  /**
   * Retorna o objeto de status completo.
   */
  getStatus() {
    return this.status;
  }
}

// Exporta uma instância única (singleton)
const statusManager = new StatusManager();
export default statusManager;