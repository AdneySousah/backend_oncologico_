'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('entrevista_medicamentos', {
      id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
      },
      entrevista_profissional_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'entrevista_profissional', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE', // Se a entrevista for apagada, limpa a relação
      },
      medicamento_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'medicamentos', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
      }
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('entrevista_medicamentos');
  }
};