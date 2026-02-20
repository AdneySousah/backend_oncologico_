'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
     await queryInterface.addColumn('entrevista_profissional', 'data_proximo_contato', { type: Sequelize.DATEONLY,});
     await queryInterface.addColumn('entrevista_profissional', 'turno_contato', { type: Sequelize.ENUM('Manhã', 'Tarde', 'Noite'),});
  },

  async down (queryInterface, Sequelize) {
     await queryInterface.removeColumn('entrevista_profissional', 'data_proximo_contato');
     await queryInterface.removeColumn('entrevista_profissional', 'turno_contato');
  }
};
