import http from 'http';
import express from 'express';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';

import logger from './src/utils/logger.js';
import { appConfig, jobsConfig } from './src/config/index.js';
import { createJobLoop } from './src/jobs/job.scheduler.js';
import statusManager from './src/utils/statusManager.js';

// Jobs
import * as atualcargoJob from './src/jobs/atualcargo.job.js';
import * as sitraxJob from './src/jobs/sitrax.job.js';

// --- Workaround para __dirname em ES Modules ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Capturadores Globais ---
process.on('uncaughtException', (error) => {
  logger.error('Erro não capturado (uncaughtException):', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Rejeição de Promise não tratada (unhandledRejection):', reason);
});

// --- 1. Inicializar Servidor Web e Socket.io ---
const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer);

// Inicializa o Status Manager com o servidor socket
statusManager.init(io);

// Serve arquivos estáticos da pasta 'public'
app.use(express.static(path.join(__dirname, 'public')));

// Rota principal (serve o painel)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'monitor.html'));
});

// Rota para o status inicial (para quem acaba de carregar a página)
app.get('/status', (req, res) => {
  res.json(statusManager.getStatus());
});

// Lida com conexões de socket
io.on('connection', (socket) => {
  logger.info(`[Monitor] Novo cliente conectado: ${socket.id}`);
  socket.emit('status-update', statusManager.getStatus()); // Envia status atual
});

// Inicia o servidor web
httpServer.listen(appConfig.monitorPort, () => {
  logger.info(`[Serviço] Hub de Integração iniciado.`);
  logger.info(`[Monitor] Painel de monitoramento rodando em http://localhost:${appConfig.monitorPort}`);
  
  // --- 2. Iniciar os Jobs (APENAS DEPOIS que o servidor subiu) ---
  
  if (jobsConfig.atualcargo.enabled) {
    createJobLoop(
      'Atualcargo',
      atualcargoJob.run,
      jobsConfig.atualcargo.interval
    );
  }

  if (jobsConfig.sitrax.enabled) {
    createJobLoop(
      'Sitrax',
      sitraxJob.run,
      jobsConfig.sitrax.interval
    );
  }
});