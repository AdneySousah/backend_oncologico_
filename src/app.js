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
app.use(cors({
    origin: 'https://frontend-oncologico.vercel.app', // URL do seu front no Vercel
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());
app.use('/files', express.static(resolve(__dirname, '..', 'uploads', 'anexos')));
// Adicione esta linha logo abaixo do seu express.static atual
app.use('/files/entrevistas', express.static(resolve(__dirname, '..', 'uploads', 'anexos_entrevistas')));
app.use(router);




export default app