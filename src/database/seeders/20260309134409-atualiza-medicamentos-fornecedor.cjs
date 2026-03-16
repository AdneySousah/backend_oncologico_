const XLSX = require('xlsx');
const path = require('path');

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const filePath = path.resolve(__dirname, '..', '..', '..', 'medicamentos1.xlsx');
    
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    
    // range: 1 ignora a primeira linha e usa a segunda como cabeçalho
    const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: null, range: 1 });

    if (data.length === 0) {
      console.log('A folha de cálculo está completamente vazia ou não foi lida corretamente.');
      return;
    }

    console.log("-------------------------------------------------");
    console.log("Colunas encontradas na folha de cálculo:", Object.keys(data[0]));
    console.log("-------------------------------------------------");

    const medicamentosPlanilha = data
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
        
        // Tratamento do Preço (lida com espaços no nome da coluna)
        const precoCru = (item.price !== null && item.price !== undefined) 
                         ? item.price 
                         : ((item[' price '] !== null && item[' price '] !== undefined) ? item[' price '] : null);
        
        // Tratamento do Fornecedor (lida com omissões de cabeçalho do Excel gerando __EMPTY)
        const fornecedorCru = item.fornecedor || 
                              item[' fornecedor '] || 
                              item['FORNECEDOR'] || 
                              item['__EMPTY_1'] || 
                              item['__EMPTY'] || 
                              null;

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
          price: precoCru !== null ? parseFloat(precoCru) : null,
          fornecedor: fornecedorCru,
          created_at: new Date(),
          updated_at: new Date()
        };
    });

    if (medicamentosPlanilha.length === 0) {
      console.log('Nenhum medicamento foi formatado.');
      return;
    }

    // 1. Busca todos os códigos TUSS que já existem na base de dados
    const medicamentosExistentes = await queryInterface.sequelize.query(
      `SELECT codigo_tuss FROM medicamentos WHERE codigo_tuss IS NOT NULL;`,
      { type: Sequelize.QueryTypes.SELECT }
    );

    // Cria um Set (conjunto) para a busca ser extremamente rápida
    const codigosTussExistentes = new Set(medicamentosExistentes.map(m => String(m.codigo_tuss)));

    const paraInserir = [];
    const paraAtualizar = [];

    // 2. Separa os dados da folha de cálculo entre "novos" e "existentes"
    for (const med of medicamentosPlanilha) {
      if (med.codigo_tuss && codigosTussExistentes.has(med.codigo_tuss)) {
        paraAtualizar.push(med);
      } else {
        paraInserir.push(med);
      }
    }

    // 3. Insere os medicamentos novos de uma só vez (Bulk Insert)
    if (paraInserir.length > 0) {
      console.log(`Inserindo ${paraInserir.length} novos medicamentos...`);
      await queryInterface.bulkInsert('medicamentos', paraInserir, {});
    } else {
      console.log('Nenhum medicamento novo para inserir.');
    }

    // 4. Atualiza os medicamentos existentes (Update)
    if (paraAtualizar.length > 0) {
      console.log(`Atualizando ${paraAtualizar.length} medicamentos existentes...`);
      
      for (const med of paraAtualizar) {
        await queryInterface.bulkUpdate('medicamentos', 
          {
            price: med.price,
            fornecedor: med.fornecedor,
            updated_at: new Date()
          }, 
          {
            codigo_tuss: med.codigo_tuss // Condição WHERE
          }
        );
      }
    } else {
      console.log('Nenhum medicamento para atualizar.');
    }

    console.log('Migração de dados finalizada com sucesso!');
  },

  down: async (queryInterface, Sequelize) => {
    return queryInterface.bulkDelete('medicamentos', null, {});
  }
};