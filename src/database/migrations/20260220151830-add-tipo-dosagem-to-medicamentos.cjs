'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('medicamentos', 'tipo_dosagem', {
      type: Sequelize.ENUM('MG', 'G', 'MCG', 'UI', 'ML', 'MG/ML'),
      allowNull: true, // Permitir nulo caso a planilha venha sem a unidade
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('medicamentos', 'tipo_dosagem');
  }
};

