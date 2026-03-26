# Deploy - Tracking System

## Railway (Recomendado)

### 1. Criar conta e projeto
- Acesse https://railway.app e faça login com GitHub
- Clique "New Project" → "Deploy from GitHub repo"
- Conecte o repositório ou use "Empty Project" → "Add Service" → "GitHub Repo"

### 2. Se não tiver repo, faça upload manual
- No Railway, crie um novo projeto
- "Add Service" → "Empty Service"
- Conecte via Railway CLI:
```bash
npm install -g @railway/cli
railway login
railway link
railway up
```

### 3. Configurar variáveis de ambiente
No Railway dashboard → seu service → "Variables":
```
SHOPIFY_STORE_DOMAIN=your-store.myshopify.com
SHOPIFY_CLIENT_ID=your_client_id
SHOPIFY_CLIENT_SECRET=your_client_secret
KLAVIYO_PRIVATE_KEY=your_klaviyo_key
PORT=3456
LOG_LEVEL=info
POLLING_INTERVAL_MS=1800000
POLLING_ORDERS_DAYS=30
NO_UPDATE_LEVEL1_HOURS=24
NO_UPDATE_LEVEL2_HOURS=72
NO_UPDATE_LEVEL3_HOURS=120
NO_UPDATE_EXCEPTION_HOURS=168
RETRY_MAX_ATTEMPTS=3
RETRY_BASE_DELAY_MS=1000
STORE_TYPE=json
STORE_JSON_PATH=./data/order-states.json
STOP_TRACKING_AFTER_DAYS=45
```

### 4. Deploy
Railway detecta automaticamente Node.js e roda `npm start`.

### 5. URL pública
Railway gera uma URL tipo: `https://tracking-system-production-xxxx.up.railway.app`
Use esta URL no ParcelPanel como webhook.

---

## Render (Alternativa)

### 1. Criar Web Service
- Acesse https://render.com
- "New" → "Web Service"
- Conecte repo GitHub ou use "Deploy from Git"

### 2. Configurar
- Environment: Node
- Build Command: `npm install`
- Start Command: `npm start`
- Instance Type: Free (para teste) ou Starter ($7/mês para 24/7)

### 3. Environment Variables
Mesmo bloco acima.

### 4. URL
Render gera: `https://tracking-system-xxxx.onrender.com`

---

## Após deploy

### Testar health
```bash
curl https://SUA-URL/health
```

### Testar Klaviyo
```bash
curl -X POST https://SUA-URL/test/klaviyo \
  -H "Content-Type: application/json" \
  -d '{"email":"seu-email@gmail.com"}'
```

### Configurar ParcelPanel
1. Shopify Admin → Apps → ParcelWILL (Parcel Panel)
2. Vá em Configurações ou Settings
3. Procure "Webhooks" ou "Webhook URL"
4. Cole: `https://SUA-URL/webhook/parcelpanel`
5. Salve

### Endpoints disponíveis
- `GET /health` - Status básico
- `GET /health/detail` - Status detalhado com métricas
- `POST /webhook/parcelpanel` - Webhook principal
- `POST /webhook/shopify` - Webhook fallback
- `POST /test/klaviyo` - Testa conexão Klaviyo
- `POST /test/simulate` - Simula um tracking update
- `GET /test/order/:orderId` - Consulta estado de um pedido
