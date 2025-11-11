# 1. Imagem Base
FROM node:18-alpine

# 2. Define o diretório de trabalho
WORKDIR /app

# 3. Copia os arquivos de dependência
COPY package.json ./
COPY package-lock.json ./ 

# 4. Instala dependências de produção
RUN npm ci --omit=dev

# 5. Instala o PM2 globalmente
RUN npm install pm2 -g

# 6. Copia o restante do código-fonte
COPY . .

# 7. Expõe a porta do painel de monitoramento
EXPOSE 9222

# 8. Comando para iniciar o serviço
# Usa o ecosystem.config.cjs para iniciar em modo cluster
CMD ["pm2-runtime", "start", "ecosystem.config.cjs"]