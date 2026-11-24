import 'dotenv/config';
import express from 'express';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

import './database/index.js'; // Importa a conexão com o banco
import router from './routes.js';
import cors from 'cors';
import authMiddleware from './middlewares/auth.js';
import checkPermission from './middlewares/checkPermission.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();

// 1. Configuração para o Ngrok não bloquear o Webhook
app.use((req, res, next) => {
    res.setHeader('ngrok-skip-browser-warning', 'true');
    next();
});

// CORS: com CORS_ORIGINS (lista separada por vírgula, ex.: https://app.dominio.com) só
// essas origens chamam a API pelo navegador. Sem a variável, segue aberto como antes
// (para não derrubar o front em produção antes de configurar).
const origensPermitidas = (process.env.CORS_ORIGINS || '').split(',').map(o => o.trim()).filter(Boolean);
if (origensPermitidas.length) {
    app.use(cors({
        origin: (origem, callback) => callback(null, !origem || origensPermitidas.includes(origem)),
    }));
} else {
    console.warn('[CORS] CORS_ORIGINS não configurada: API aceita chamadas de qualquer origem.');
    app.use(cors());
}

// 2. PARSERS (Essenciais para ler os dados que chegam)
app.use(express.json()); // Para o seu Front-end (JSON)
app.use(express.urlencoded({ extended: true })); // <--- ADICIONE ESTA LINHA (Para a Twilio)

// 3. ARQUIVOS ESTÁTICOS (anexos de pacientes): só com login e permissão.
// Antes qualquer URL vazada abria o documento sem autenticação. Nenhuma tela usa
// hoje; fica para links antigos de termos gerados no fluxo anterior.
app.use('/files', authMiddleware, checkPermission(['termo', 'termos', 'pacientes'], 'acessar'), express.static(resolve(__dirname, '..', 'uploads', 'anexos')));

// 4. ROTAS
app.use(router);

// Erros que escapam das rotas (ex.: upload grande demais ou de tipo errado no multer)
// voltam como JSON legível em vez da página de erro padrão do Express.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
    if (err && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'Arquivo grande demais (máximo 5 MB).' });
    }
    if (err && (err.status === 400 || err.name === 'MulterError')) {
        return res.status(400).json({ error: err.message });
    }
    console.error('Erro não tratado:', err);
    return res.status(500).json({ error: 'Erro interno no servidor.' });
});

export default app;