const multer = require('multer');
const { extname, resolve } = require('path');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');

// Nova pasta para os anexos das entrevistas
const uploadDir = resolve(__dirname, '..', '..', 'uploads', 'anexos_entrevistas');

// Garante que a pasta existe quando o servidor iniciar
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

module.exports = {
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (req, file, cb) => {
      // Gera nome único para evitar conflito
      return cb(null, uuidv4() + extname(file.originalname));
    },
  }),
};