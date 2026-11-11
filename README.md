# 🏡 Controlador de Reservas · Pousada

Sistema leve, moderno e sem dependências externas para gestão e controle de reservas de pousadas e pequenos hotéis.

---

## ✨ Principais Funcionalidades

- **📊 Painel & Visão Geral:** Métricas de ocupação em tempo real, chegadas/partidas do dia e alertas rápidos.
- **📅 Calendário Interativo:** Grid visual de 21 dias com ocupação por quarto, status e navegação temporal.
- **🛎️ Gestão Completa de Reservas:**
  - Bloqueio automático de sobreposições e conflitos de datas;
  - Cálculo de diárias com suporte a valores promocionais e descontos manuais;
  - Status do ciclo de vida: *Confirmada*, *Hospedado*, *Finalizada* e *Cancelada*.
- **🛏️ Controle de Quartos & Assinaturas SKY:** Cadastro de quartos, capacidades e acompanhamento do vencimento de TV por assinatura com renovação rápida (+30 dias).
- **👥 Cadastro de Hóspedes & Canais:** Gestão de contatos e fontes de reserva (Direta, Booking, Agências, etc.).
- **⚡ Zero Dependências em Runtime:** Desenvolvido puramente em Node.js nativo (`http`, `crypto`, `fs`).
- **☁️ Armazenamento Híbrido:** Integração com **Supabase** para persistência em nuvem com fallback automático para arquivo local (`data/db.json`).

---

## 🚀 Como Executar

### Pré-requisitos
- [Node.js](https://nodejs.org/) (versão 18 ou superior)

### Passo a Passo

1. **Clone o repositório:**
   ```bash
   git clone https://github.com/GabrielNeres44/controlador-reservas.git
   cd controlador-reservas
   ```

2. **Inicie o servidor:**
   ```bash
   npm start
   # ou
   node server.js
   ```

3. **Acesse no navegador:**
   Abra [http://localhost:3000](http://localhost:3000)

---

## 🧪 Testes Automatizados

O projeto utiliza o executor de testes nativo do Node.js:

```bash
npm test
```

---

## ⚙️ Variáveis de Ambiente (Opcional)

| Variável | Descrição | Padrão |
| :--- | :--- | :--- |
| `PORT` | Porta HTTP do servidor | `3000` |
| `SUPABASE_URL` | URL do projeto Supabase | Supabase configurado |
| `SUPABASE_KEY` | Chave de API Supabase | Chave do projeto |
| `DB_FILE` | Caminho do arquivo de banco local | `data/db.json` |

---

## 📁 Estrutura do Projeto

```text
controlador-reservas/
├── public/           # Frontend (HTML, CSS e JavaScript Vanilla)
├── src/
│   ├── logic.js      # Regras de negócio e validações de reserva
│   └── storage.js    # Camada de persistência (Supabase + Local)
├── supabase/         # Migrations SQL e configurações Supabase
├── test/             # Testes unitários e de integração
├── server.js         # Servidor HTTP nativo
└── package.json
```

---

Feito com simplicidade e foco na eficiência operacional hoteleira.
