const multer = require('multer');
const { extname, resolve } = require('path');
const { v4 } = require('uuid');

module.exports = {
  // Salvamos em disco localmente para processar rápido
  storage: multer.diskStorage({
    destination: resolve(__dirname, '..', '..', 'tmp', 'uploads'), // Certifique-se que essa pasta existe
    filename: (req, file, cb) => {
      // Gera um nome único: id-aleatorio.extensao
      return cb(null, v4() + extname(file.originalname));
    },
  }),
};