const XLSX = require('xlsx');
const path = require('path');

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const filePath = path.resolve(__dirname, '..', '..', '..', 'medicamentos.xlsx');
    
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    
    // defval: null garante que células vazias fiquem com valor null
    // Se o seu cabeçalho REAL estiver na segunda linha (linha 2 do Excel), 
    // mude a configuração abaixo para: { defval: null, range: 1 }
    const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: null, range: 1 });

    if (data.length === 0) {
      console.log('A planilha está completamente vazia ou não foi lida corretamente.');
      return;
    }

    // DEBUG: Mostra as chaves (colunas) que o leitor encontrou na primeira linha de dados
    console.log("-------------------------------------------------");
    console.log("Colunas encontradas na planilha:", Object.keys(data[0]));
    console.log("-------------------------------------------------");

    const medicamentos = data
      .filter(item => item.nome && String(item.nome).trim() !== '') 
      .map(item => {
        const nomeStr = String(item.nome);
        const regexDosagem = /([\d.,\s+()]+)\s*(MG|G|MCG|UI|ML|MG\/ML)/i;
        const match = nomeStr.match(regexDosagem);
        
        let valorDosagem = null;
        let unidadeDosagem = null;

        if (match) {
          valorDosagem = match[1].trim(); 
          unidadeDosagem = match[2].toUpperCase(); 
        }
        
        return {
          codigo_tuss: item.codigo_tuss ? String(item.codigo_tuss) : null,
          laboratorio: item.laboratorio || null,
          tipo_produto: item.tipo_produto || null,
          nome_comercial: item.nome_comercial || null,
          principio_ativo: item.principio_ativo || null,
          nome: nomeStr,
          descricao: item.descricao || null,
          qtd_capsula: item.qtd_capsula ? parseInt(item.qtd_capsula) : 0,
          dosagem: valorDosagem,
          tipo_dosagem: unidadeDosagem,
          created_at: new Date(),
          updated_at: new Date()
        };
    });

    if (medicamentos.length === 0) {
      console.log('Nenhum medicamento foi formatado. O bulkInsert foi cancelado para evitar erro de SQL.');
      return;
    }

    console.log(`Iniciando inserção de ${medicamentos.length} medicamentos válidos...`);
    return queryInterface.bulkInsert('medicamentos', medicamentos, {});
  },

  down: async (queryInterface, Sequelize) => {
    return queryInterface.bulkDelete('medicamentos', null, {});
  }
};