# 🚚 Integração de Rastreamento (Atualcargo) com Sankhya (MGE)

Este projeto é um serviço de integração 24/7, desenvolvido em Node.js e containerizado com Docker, cujo objetivo é sincronizar a localização em tempo real de veículos da API Atualcargo (Rastreamos.APP) com uma tabela customizada no ERP Sankhya.

O serviço é projetado para ser robusto, gerenciando automaticamente as sessões de ambas as APIs, tratando erros e reiniciando sozinho em caso de falhas, garantindo alta disponibilidade.

---

### ✨ Funcionalidades

* 🛰️ **Sincronização de Frota:** Busca a localização de todos os veículos da Atualcargo em tempo real.
* 🔄 **Mapeamento de Ignição:** Converte o status `ignition` ("ON" / "OFF") para o padrão do Sankhya ("S" / "N").
* 🚫 **Controle de Duplicidade:** Consulta o último registro no Sankhya e insere apenas localizações mais recentes, evitando dados repetidos.
* 🔑 **Gestão de Sessão:** Lida automaticamente com a expiração de tokens, realizando novos logins no Sankhya e na Atualcargo conforme necessário.
* 📝 **Logs Robustos:** Utiliza `winston` para registrar operações (`app.log`) e erros (`error.log`), facilitando o monitoramento.
* 🚀 **Pronto para Produção 24/7:** Utiliza Docker e PM2 para garantir que o serviço rode continuamente e reinicie automaticamente em caso de falhas.

### 🛠️ Tecnologias Utilizadas

* **Node.js**: Ambiente de execução do serviço.
* **Docker**: Containerização para implantação em produção.
* **Docker Compose**: Orquestração do container e das variáveis de ambiente.
* **PM2**: Gerenciador de processos para Node.js, garantindo alta disponibilidade.
* **Winston**: Biblioteca de logging.
* **Axios**: Cliente HTTP para comunicação com as APIs.

---

### ⚙️ Como Funciona (O Fluxo da Integração)

<details>
<summary>Clique para expandir e ver o ciclo de execução detalhado</summary>

O serviço opera em um ciclo contínuo, orquestrado pelo `app.js`:

1.  **Início do Ciclo:** O serviço é iniciado.
2.  **Verificação de Cache:** O serviço verifica se possui dados de posições em cache.
3.  **Etapa 1: Atualcargo (Se o cache estiver vazio)**
    *   Faz login na API da Atualcargo para obter um token.
    *   Aguarda 65 segundos (configurável) para evitar o *Rate Limit* (Erro 425).
    *   Busca a última localização de toda a frota na rota `/api/positions/v1/last`.
    *   Salva os dados recebidos no cache.
4.  **Etapa 2: Sankhya (Se o cache contiver dados)**
    *   Faz login na API do Sankhya (MGE) para obter um `JSessionID`.
    *   Executa uma query no Sankhya (`DbExplorerSP.executeQuery`) para buscar o `CODVEICULO` correspondente a cada `PLACA`.
    *   Executa uma segunda query para buscar a data/hora (`DATHOR`) do último registro salvo para cada `CODVEICULO`.
    *   Filtra os dados em cache, ignorando posições cuja data/hora (`pos.date`) é igual ou anterior à `DATHOR` já registrada.
    *   Salva todos os registros novos na tabela `AD_LOCATCAR` usando o `DatasetSP.save`.
5.  **Conclusão do Ciclo:**
    *   Se a Etapa 2 foi bem-sucedida, o cache é limpo.
    *   Se a Etapa 2 falhou (ex: Sankhya offline), o cache é mantido e a Etapa 2 será tentada novamente após 90 segundos, pulando a Etapa 1.
6.  **Pausa:** O serviço aguarda 5 minutos (configurável) antes de iniciar um novo ciclo completo (Etapa 1).

</details>

---

### 🚀 Como Executar (Produção 24/7)

Este método é o único recomendado para produção. Ele usa o `docker-compose` para baixar o código do GitHub, construir a imagem e rodar o container com todas as variáveis de ambiente necessárias.

**Não é necessário clonar o repositório.**

#### Passo 1: Crie o arquivo `docker-compose.yml`

Em um diretório vazio no seu servidor (ex: `/opt/integracao-sankhya`), crie um arquivo chamado `docker-compose.yml` e cole o conteúdo abaixo.

**⚠️ Importante:** Preencha os valores de exemplo (`SEU..._AQUI`) com suas credenciais reais.

```yaml
services:
  
  integracao-sankhya:
    
    # Constrói a imagem diretamente do repositório GitHub
    build:
      context: https://github.com/robertocjunior/integracao-sankhya-atualcargo.git#main
      dockerfile: Dockerfile
    
    # Nome do container que será criado
    container_name: sankhya-service
    
    # Garante que o container sempre reinicie
    restart: always
    
    # Injeta as credenciais e configurações como variáveis de ambiente
    environment:
      # --- API ATUALCARGO ---
      ATUALCARGO_URL: "https://external.atualcargo.com.br"
      ATUALCARGO_API_KEY: "SUA_CHAVE_API_ATUALCARGO_AQUI"
      ATUALCARGO_USERNAME: "SEU_USUARIO_ATUALCARGO_AQUI"
      ATUALCARGO_PASSWORD: "SUA_SENHA_ATUALCARGO_AQUI"
      
      # --- API SANKHYA ---
      SANKHYA_URL: "http://seu.sankhya.com.br:8180/mge"
      SANKHYA_CONTINGENCY_URL: "http://seu.sankhya2.com.br:8180/mge"
      SANKHYA_USER: "SEU_USUARIO_SANKHYA_AQUI"
      SANKHYA_PASSWORD: "SUA_SENHA_SANKHYA_AQUI"
      
      # --- CONFIGURAÇÕES DO CICLO ---
      WAIT_AFTER_LOGIN_MS: "65000"
      WAIT_BETWEEN_CYCLES_MS: "300000"
      WAIT_AFTER_ERROR_MS: "90000"
      ATUALCARGO_POSITION_TIMEOUT_MS: "130000"

    # Gerenciamento de Logs
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
```

#### Passo 2: Suba o Serviço

No terminal, dentro do diretório onde você criou o `docker-compose.yml`, execute:

```bash
docker-compose up -d --build
```

**O que este comando faz:**

*   `docker-compose up`: Inicia o serviço.
*   `-d`: Roda em modo "detached" (em segundo plano).
*   `--build`: Força o Docker a baixar a versão mais recente do código do GitHub e construir a imagem. (Use este comando sempre que quiser atualizar o serviço).

Pronto! Seu serviço está no ar.

---

### 📊 Monitoramento e Logs

#### Via Docker Compose (Recomendado)

Use o comando abaixo (no mesmo diretório do `docker-compose.yml`) para ver os logs do serviço em tempo real.

```bash
docker-compose logs -f
```

(Pressione `Ctrl+C` para sair dos logs).

#### Via Arquivos (Dentro do Container)

O serviço também escreve logs em arquivos *dentro* do container. Você pode acessá-los para uma análise mais profunda se necessário:

```bash
# Entra no terminal do container
docker exec -it sankhya-service /bin/sh

# Navega até a pasta de logs
cd logs

# Vê o log de aplicação
cat app.log

# Sai do container
exit
```
