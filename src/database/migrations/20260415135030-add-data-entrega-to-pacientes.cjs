'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('pacientes', 'data_entrega_medicamento', {
      type: Sequelize.DATEONLY, // Usamos DATEONLY pois só precisamos do dia, mês e ano
      allowNull: true,
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('pacientes', 'data_entrega_medicamento');
  }
};