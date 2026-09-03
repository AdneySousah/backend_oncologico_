'use strict';

// paciente_termos_anexos guardava os PDFs de termo salvos em disco. Com o
// termo agora sendo gerado ao vivo (a partir da versão vinculada ao
// paciente, sem nenhum arquivo salvo), essa tabela e a pasta de arquivos
// que ela referenciava deixam de ser necessárias.
module.exports = {
  up: async (queryInterface) => {
    await queryInterface.dropTable('paciente_termos_anexos');
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('paciente_termos_anexos', {
      id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
      },
      paciente_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'pacientes', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      arquivo_path: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      nome_original: {
        type: Sequelize.STRING,
        allowNull: true,
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
  }
};
