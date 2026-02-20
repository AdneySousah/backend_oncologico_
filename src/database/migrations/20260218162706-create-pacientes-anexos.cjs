'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    return queryInterface.createTable('pacientes_anexos', {
      id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
      },
      paciente_id: {
        type: Sequelize.INTEGER,
        references: { model: 'pacientes', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE', // Se apagar o paciente, apaga os registros de anexos
        allowNull: false,
      },
      nome: {
        type: Sequelize.STRING,
        allowNull: false, // Ex: "Receita", "Exame de Sangue"
      },
      file_path: {
        type: Sequelize.STRING,
        allowNull: false, // Nome do arquivo gerado pelo multer
      },
      original_name: {
        type: Sequelize.STRING,
        allowNull: false, // Nome original do arquivo caso queira exibir depois
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
    return queryInterface.dropTable('pacientes_anexos');
  },
};