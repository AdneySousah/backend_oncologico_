'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.removeColumn('exames', 'data_exame_resultado');
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.addColumn('exames', 'data_exame_resultado', { type: Sequelize.DATEONLY });

     
  }
};
