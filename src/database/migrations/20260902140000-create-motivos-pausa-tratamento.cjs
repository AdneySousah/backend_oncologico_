'use strict';

// Tabela compartilhada de motivos, usada tanto pra "Pausar Tratamento"
// (Necessidade de Navegação) quanto pra "Descontinuar Medicamento"
// (Telemonitoramento) — mesmo motivo, mesma contabilização nos dois fluxos.
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('motivos_pausa_tratamento', {
      id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
      },
      descricao: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      ativo: {
        type: Sequelize.BOOLEAN,
        defaultValue: true,
        allowNull: false,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
    });
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('motivos_pausa_tratamento');
  }
};
