# 🚚 Integração de Rastreamento (Atualcargo) com Sankhya (MGE)

Este projeto é um serviço de integração 24/7, desenvolvido em Node.js e containerizado com Docker, cujo objetivo é sincronizar a localização em tempo real de veículos da API Atualcargo (Rastreamos.APP) com uma tabela customizada no ERP Sankhya.

O serviço é projetado para ser robusto, gerenciando automaticamente as sessões de ambas as APIs, tratando erros e reiniciando sozinho em caso de falhas, garantindo alta disponibilidade.

---

### 📋 Índice

1. [Funcionalidades](#-funcionalidades)
2. [Tecnologias Utilizadas](#-tecnologias-utilizadas)
3. [Como Funciona (O Fluxo)](#-como-funciona-o-fluxo-da-integração)
4. [Instalação e Configuração](#-instalação-e-configuração)
5. [Como Executar](#️-como-executar)
6. [Monitoramento e Logs](#-monitoramento-e-logs)

---

### ✨ Funcionalidades

*   🛰️ **Sincronização de Frota:** Busca a localização de todos os veículos da Atualcargo em tempo real.
*   🔄 **Mapeamento de Ignição:** Converte o status `ignition` ("ON" / "OFF") para o padrão do Sankhya ("S" / "N").
*   🚫 **Controle de Duplicidade:** Consulta o último registro no Sankhya e insere apenas localizações mais recentes, evitando dados repetidos.
*   🔑 **Gestão de Sessão:** Lida automaticamente com a expiração de tokens, realizando novos logins no Sankhya e na Atualcargo conforme necessário.
*   📝 **Logs Robustos:** Utiliza `winston` para registrar operações (`app.log`) e erros (`error.log`), facilitando o monitoramento.
*   🚀 **Pronto para Produção 24/7:** Utiliza Docker e PM2 para garantir que o serviço rode continuamente e reinicie automaticamente em caso de falhas.

### 🛠️ Tecnologias Utilizadas

*   **Node.js**: Ambiente de execução do serviço.
*   **Docker**: Containerização para implantação em produção.
*   **PM2**: Gerenciador de processos para Node.js, garantindo alta disponibilidade.
*   **Winston**: Biblioteca de logging.
*   **Axios**: Cliente HTTP para comunicação com as APIs.

---

### ⚙️ Como Funciona (O Fluxo da Integração)

<details>
  <summary>Clique para expandir e ver o ciclo de execução detalhado</summary>
  
  O serviço opera em um ciclo contínuo, orquestrado pelo `app.js`:

  1.  **Início do Ciclo:** O serviço é iniciado.
  2.  **Login (Atualcargo):** Faz login na API da Atualcargo para obter um token de autenticação (válido por 5 minutos).
  3.  **Espera Estratégica:** Aguarda 65 segundos (configurável) para evitar o *Rate Limit* (Erro 425) da API.
  4.  **Coleta (Atualcargo):** Busca a última localização de toda a frota na rota `/api/positions/v1/last`.
  5.  **Login (Sankhya):** Faz login na API do Sankhya (MGE) para obter um `JSessionID`.
  6.  **Mapeamento (Sankhya):** Executa uma query no Sankhya (`DbExplorerSP.executeQuery`) para buscar o `CODVEICULO` correspondente a cada `PLACA`.
  7.  **Verificação (Sankhya):** Executa uma segunda query para buscar a data/hora (`DATHOR`) do último registro salvo para cada `CODVEICULO`.
  8.  **Filtragem:** O serviço compara os dados em memória:
      *   Ignora placas não encontradas no Sankhya.
      *   Ignora posições cuja data/hora (`pos.date`) é igual ou anterior à `DATHOR` já registrada.
  9.  **Gravação (Sankhya):** Salva todos os registros novos e válidos na tabela `AD_LOCATCAR` usando o `DatasetSP.save`.
  10. **Pausa:** Aguarda um tempo configurável (padrão: 5 minutos) e reinicia o ciclo a partir da Etapa 4. Novos logins só são feitos se a sessão expirar.
</details>

---

### 🔧 Instalação e Configuração

**Pré-requisitos:**
*   Node.js (v18 ou superior)
*   Docker (Recomendado para produção)

#### 1. Arquivo de Ambiente (`.env`)

Crie um arquivo chamado `.env` na raiz do projeto, copie o conteúdo abaixo e preencha com suas credenciais.

```dotenv
# =======================================
# API ATUALCARGO (RASTREAMOS.APP)
# =======================================
ATUALCARGO_URL=https://external.atualcargo.com.br
ATUALCARGO_API_KEY=SUAAPIKEYAQUI
ATUALCARGO_USERNAME=SEUUSERNAMEAQUI
ATUALCARGO_PASSWORD=SUASENHAAQUI

# =======================================
# API SANKHYA
# =======================================
# URL base do MGE
SANKHYA_URL=http://sankhya.com.br:8026/mge
SANKHYA_USER=ADMIN
SANKHYA_PASSWORD=teste

# =======================================
# CONFIGURAÇÕES DO CICLO
# =======================================
# Tempo de espera após login na Atualcargo para evitar Rate Limit (Erro 425)
WAIT_AFTER_LOGIN_MS=65000

# Tempo de espera entre os ciclos de busca (padrão: 5 minutos)
WAIT_BETWEEN_CYCLES_MS=300000

# Tempo de espera antes de tentar reconectar após um erro
WAIT_AFTER_ERROR_MS=30000

# Timeout máximo para a API de posições da Atualcargo (padrão: 130 segundos)
ATUALCARGO_POSITION_TIMEOUT_MS=130000
```

#### 2. Instalar Dependências

```bash
npm install
```

---

### ▶️ Como Executar

#### 1. Modo de Desenvolvimento (Local)
Ideal para testes rápidos. O terminal deve permanecer aberto.

```bash
npm start
```

#### 2. Modo de Produção 24/7 (Recomendado com Docker)
Este método cria um container que roda o serviço em segundo plano e reinicia automaticamente.

**Passo 1: Construir a Imagem Docker**

Na raiz do projeto (onde está o `Dockerfile`), execute:
```bash
docker build -t integracao-sankhya .
```

**Passo 2: Rodar o Container**

O comando abaixo inicia o container em modo `detached` (`-d`), garante que ele sempre reinicie (`--restart always`) e injeta as credenciais do arquivo `.env`.

```bash
docker run -d \
  --name "sankhya-service" \
  --restart always \
  --env-file ./.env \
  integracao-sankhya
```

Seu serviço agora está rodando 24/7!

---

### 📊 Monitoramento e Logs

#### Via Docker (Recomendado)
Use o nome do container definido no comando `docker run` para ver os logs em tempo real.

```bash
docker logs -f sankhya-service
```

#### Via Arquivos (Local)
Os logs são salvos automaticamente na pasta `/logs/` (criada na primeira execução).

*   `logs/app.log`: Contém todos os logs de informação e sucesso.
*   `logs/error.log`: Contém apenas os logs de erro.
