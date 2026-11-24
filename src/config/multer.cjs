const multer = require('multer');
const { extname, resolve } = require('path');
const { v4 } = require('uuid');

// Upload de planilhas (importação da Ficha RAM). Antes não havia limite de tamanho nem de
// tipo: qualquer arquivo de qualquer tamanho era gravado em disco.
const EXTENSOES_PERMITIDAS = ['.xlsx', '.xls', '.csv'];
const TAMANHO_MAXIMO = 5 * 1024 * 1024; // 5 MB

module.exports = {
  // Salvamos em disco localmente para processar rápido
  storage: multer.diskStorage({
    destination: resolve(__dirname, '..', '..', 'tmp', 'uploads'), // Certifique-se que essa pasta existe
    filename: (req, file, cb) => {
      // Gera um nome único: id-aleatorio.extensao
      return cb(null, v4() + extname(file.originalname).toLowerCase());
    },
  }),
  limits: { fileSize: TAMANHO_MAXIMO, files: 1 },
  fileFilter: (req, file, cb) => {
    const extensao = extname(file.originalname || '').toLowerCase();
    if (!EXTENSOES_PERMITIDAS.includes(extensao)) {
      const erro = new Error('Envie uma planilha .xlsx, .xls ou .csv.');
      erro.status = 400;
      return cb(erro);
    }
    return cb(null, true);
  },
};
