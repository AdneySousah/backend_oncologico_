'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.removeColumn('entrevista_profissional', 'turno_contato');
     
  },

  async down (queryInterface, Sequelize) {
     await queryInterface.addColumn('entrevista_profissional', 'turno_contato', { type: Sequelize.ENUM('Manhã', 'Tarde', 'Noite') });
    
  }
};
