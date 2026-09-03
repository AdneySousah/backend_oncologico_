import xlsx from 'xlsx';

/**
 * Lê a primeira planilha de um arquivo Excel e retorna os dados como array de objetos.
 * Usado por todos os controllers que fazem import/validate de planilha (Especialidades,
 * Diagnósticos, Reação Adversa, Medicamentos, Prestadores Médicos) para manter um único
 * padrão de leitura.
 *
 * @param {string} filePath - Caminho do arquivo Excel no disco.
 * @param {object} [options] - Opções repassadas para xlsx.utils.sheet_to_json
 *   (ex: { range: 1 } para pular uma linha de cabeçalho informativo, { defval: null }).
 * @returns {Array<object>}
 */
export const parseExcel = (filePath, options = {}) => {
    try {
        const workbook = xlsx.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        return xlsx.utils.sheet_to_json(sheet, options);
    } catch (error) {
        throw new Error('Falha ao ler o arquivo Excel.');
    }
};