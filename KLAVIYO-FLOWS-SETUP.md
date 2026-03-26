# 🎯 GUIA COMPLETO — Klaviyo Flows Setup (Tracking System)

## ✅ Flow 1: Tracking - No Update Yet [JÁ CRIADO]
- **Status:** Draft ✅
- **URL:** https://www.klaviyo.com/flow/TKKfrA/edit
- **Trigger:** Tracking No Update Yet
- **Subject:** Your order is on its way! Here's what to expect
- **Template:** email-templates/01-no-update-yet.html

---

## 📋 FLOWS PARA CRIAR (6 restantes)

### Para cada flow abaixo, siga estes passos:
1. Vá em **Flows → Create Flow → Build your own**
2. Digite o **Nome** do flow
3. Clique em **Create manually**
4. Na tela de trigger, clique em **Your metrics → API**
5. Selecione a **Metric** correspondente
6. Clique em **Save** → **Confirm and save**
7. Arraste **Email** para o flow
8. Configure **Subject line** e **Preview text**
9. Clique em **Set up email** para colar o HTML do template

---

## Flow 2: Tracking - In Transit China
- **Nome:** Tracking - In Transit China
- **Trigger Metric (API):** Tracking In Transit China
- **Subject:** Great news! Your order left the warehouse 🚚
- **Preview text:** Your package has been picked up by our carrier and is on its way.
- **Template HTML:** email-templates/02-in-transit-china.html
- **Re-entry:** Allow re-entry

## Flow 3: Tracking - Departed Origin
- **Nome:** Tracking - Departed Origin
- **Trigger Metric (API):** Tracking Departed Origin
- **Subject:** Your package is heading to the US! ✈️
- **Preview text:** Exciting! Your order departed and is on an international flight to the US.
- **Template HTML:** email-templates/03-departed-origin.html
- **Re-entry:** Allow re-entry

## Flow 4: Tracking - Arrived US Hub
- **Nome:** Tracking - Arrived US Hub
- **Trigger Metric (API):** Tracking Arrived US Hub
- **Subject:** Your order arrived in the US! 🇺🇸
- **Preview text:** Almost there! Your package is now in the United States.
- **Template HTML:** email-templates/04-arrived-us-hub.html
- **Re-entry:** Allow re-entry

## Flow 5: Tracking - In Transit US
- **Nome:** Tracking - In Transit US
- **Trigger Metric (API):** Tracking In Transit US
- **Subject:** Almost there! Your package is on its way to you 🚛
- **Preview text:** Your order is being delivered within the US. Expected 1-3 days.
- **Template HTML:** email-templates/05-in-transit-us.html
- **Re-entry:** Allow re-entry

## Flow 6: Tracking - Delivered
- **Nome:** Tracking - Delivered
- **Trigger Metric (API):** Tracking Delivered
- **Subject:** Your order has been delivered! 🎉
- **Preview text:** Your package arrived! We hope you love it.
- **Template HTML:** email-templates/06-delivered.html
- **Re-entry:** Allow re-entry

## Flow 7: Tracking - Exception
- **Nome:** Tracking - Exception
- **Trigger Metric (API):** Tracking Exception
- **Subject:** Important update about your order ⚠️
- **Preview text:** We noticed a shipping issue and wanted to keep you informed.
- **Template HTML:** email-templates/07-exception.html
- **Re-entry:** Allow re-entry

---

## 🔧 COMO COLAR O HTML NO EMAIL DO KLAVIYO

1. No flow editor, clique no bloco de email
2. Clique em **"Set up email"** ou **"Configurar e-mail"**
3. Escolha **"HTML editor"** (não o drag & drop)
4. Abra o arquivo .html correspondente
5. Copie TODO o conteúdo (Ctrl+A → Ctrl+C)
6. Cole no editor HTML do Klaviyo (Ctrl+V)
7. Salve

---

## 🚀 DEPOIS DE CRIAR TODOS OS FLOWS

1. Volte para cada flow
2. Clique em **"Update status"** no canto superior direito
3. Mude de **Draft** para **Live**

---

## 📊 VARIÁVEIS DISPONÍVEIS NOS TEMPLATES

Os templates usam estas variáveis do evento Klaviyo:

| Variável | Descrição |
|----------|-----------|
| `{{ event.order_id }}` | ID do pedido Shopify |
| `{{ event.order_number }}` | Número do pedido (#1234) |
| `{{ event.tracking_number }}` | Código de rastreamento |
| `{{ event.tracking_url }}` | URL de rastreamento |
| `{{ event.raw_status }}` | Status bruto da transportadora |
| `{{ event.mapped_status }}` | Status normalizado |
| `{{ event.description }}` | Descrição legível |
| `{{ event.days_since_shipped }}` | Dias desde envio |
| `{{ event.escalation_level }}` | Nível de escalação (no_update) |

---

## 🔗 URLs IMPORTANTES

- **Tracking System:** https://tracking-system-production-54d2.up.railway.app
- **Health Check:** https://tracking-system-production-54d2.up.railway.app/health
- **Test Klaviyo:** POST https://tracking-system-production-54d2.up.railway.app/test/klaviyo
- **Simulate:** POST https://tracking-system-production-54d2.up.railway.app/test/simulate
- **Railway Dashboard:** https://railway.com/project/20d1b03a-0a59-41c7-bfb1-7cb502db5dd1
- **Klaviyo Flows:** https://www.klaviyo.com/flows
