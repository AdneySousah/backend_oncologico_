import xlsx from 'xlsx';

export const parseExcel = (filePath) => {
    try {
        const workbook = xlsx.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        return xlsx.utils.sheet_to_json(sheet);
    } catch (error) {
        throw new Error('Falha ao ler o arquivo Excel.');
    }
};