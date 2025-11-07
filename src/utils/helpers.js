import logger from './logger.js';

/**
 * Cria uma pausa assíncrona
 * @param {number} ms - Tempo em milissegundos
 */
export const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Formata data da API (YYYY-MM-DD HH:mm:ss) para o formato do Sankhya (DD/MM/YYYY HH:mm:ss)
 * @param {string} apiDate - Data no formato "2025-11-03 08:38:12"
 */
export function formatSankhyaDate(apiDate) {
  try {
    const [datePart, timePart] = apiDate.split(' ');
    const [year, month, day] = datePart.split('-');
    if (!year || !month || !day || !timePart) {
      throw new Error('Formato de data incompleto');
    }
    return `${day}/${month}/${year} ${timePart}`;
  } catch (e) {
    logger.warn(`Data inválida recebida: ${apiDate}. Usando data atual. Erro: ${e.message}`);
    // Retorna a data/hora atual formatada em pt-BR
    return new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  }
}

/**
 * Parseia data da API Atualcargo (YYYY-MM-DD HH:mm:ss) para um objeto Date
 * @param {string} apiDate - "2025-11-03 11:38:12"
 */
export function parseAtualcargoDate(apiDate) {
  try {
    // Converte "2025-11-03 11:38:12" para "2025-11-03T11:38:12"
    return new Date(apiDate.replace(' ', 'T'));
  } catch (e) {
    logger.warn(`Data (Atualcargo) inválida: ${apiDate}.`);
    return null;
  }
}

/**
 * Parseia data da query Sankhya (DDMMYYYY HH:mm:ss) para um objeto Date
 * @param {string} sankhyaDate - "03112025 14:01:00"
 */
export function parseSankhyaQueryDate(sankhyaDate) {
  try {
    const day = sankhyaDate.substring(0, 2);
    const month = sankhyaDate.substring(2, 4);
    const year = sankhyaDate.substring(4, 8);
    const time = sankhyaDate.substring(9); // "14:01:00"
    // Retorna objeto Date de "YYYY-MM-DDTHH:mm:ss"
    return new Date(`${year}-${month}-${day}T${time}`);
  } catch (e) {
    logger.warn(`Data (Sankhya Query) inválida: ${sankhyaDate}.`);
    return null;
  }
}

/**
 * [NOVO] Extrai o número da placa de uma isca.
 * @param {string} baitPlate - "ISCA3969"
 * @returns {string} "3969"
 */
export function getBaitNumber(baitPlate) {
  if (!baitPlate) return null;
  // Remove "ISCA" (ignorando case) e espaços
  return baitPlate.replace(/ISCA/i, '').trim();
}