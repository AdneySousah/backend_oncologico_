'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Copia o valor de updated_at para a nova coluna apenas nos registros concluídos
    // ATENÇÃO: Verifique se no seu banco a coluna se chama 'updated_at' ou 'updatedAt'
    // Se for 'updatedAt', mude no script abaixo.
    return queryInterface.sequelize.query(`
      UPDATE monitoramento_medicamentos 
      SET data_telemonitoramento_efetivado = updated_at 
      WHERE status = 'CONCLUIDO' 
      AND data_telemonitoramento_efetivado IS NULL;
    `);
  },

  down: async (queryInterface, Sequelize) => {
    // Opcional: Caso precise reverter a migration, esvaziamos a coluna
    return queryInterface.sequelize.query(`
      UPDATE monitoramento_medicamentos 
      SET data_telemonitoramento_efetivado = NULL;
    `);
  }
};