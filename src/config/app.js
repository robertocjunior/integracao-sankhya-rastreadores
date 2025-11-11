import dotenv from 'dotenv';
dotenv.config();

export const appConfig = {
  logLevel: process.env.LOG_LEVEL || 'info',
  // Converte segundos para milissegundos
  timeout: parseInt(process.env.REQUEST_TIMEOUT_MS, 10) || 120000,
  
  // Configurações de retentativa do Sankhya
  sankhyaRetryLimit: parseInt(process.env.SANKHYA_RETRY_LIMIT_BEFORE_SWAP, 10) || 2,
  
  // Tempo de espera do Job após um erro
  jobRetryDelayMs: parseInt(process.env.JOB_RETRY_DELAY_MS, 10) || 60000,

  // Porta do painel web de monitoramento
  monitorPort: parseInt(process.env.MONITOR_PORT, 10) || 9222,
};