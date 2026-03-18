import 'dotenv/config';
import express from 'express';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

import './database/index.js'; // Importa a conexão com o banco
import router from './routes.js';
import cors from 'cors';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();

// 1. Configuração para o Ngrok não bloquear o Webhook
app.use((req, res, next) => {
    res.setHeader('ngrok-skip-browser-warning', 'true');
    next();
});

app.use(cors());

// 2. PARSERS (Essenciais para ler os dados que chegam)
app.use(express.json()); // Para o seu Front-end (JSON)
app.use(express.urlencoded({ extended: true })); // <--- ADICIONE ESTA LINHA (Para a Twilio)

// 3. ARQUIVOS ESTÁTICOS
app.use('/files', express.static(resolve(__dirname, '..', 'uploads', 'anexos')));
app.use('/files/entrevistas', express.static(resolve(__dirname, '..', 'uploads', 'anexos_entrevistas')));

// 4. ROTAS
app.use(router);

export default app;