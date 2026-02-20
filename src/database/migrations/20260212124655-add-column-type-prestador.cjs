'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.addColumn('prestador_medico', 'tipo', { type: Sequelize.ENUM('hospital', 'clinica', 'laboratorio') });

  },

  async down (queryInterface, Sequelize) {
    await queryInterface.removeColumn('prestador_medico', 'tipo');
     
  }
};
