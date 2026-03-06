'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('pacientes', 'medicamento_id', {
      type: Sequelize.INTEGER,
      references: { model: 'medicamentos', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL', // Se o medicamento for apagado, o campo fica null
      allowNull: true,
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('pacientes', 'medicamento_id');
  }
};