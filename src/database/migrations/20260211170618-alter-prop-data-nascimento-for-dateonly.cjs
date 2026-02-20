'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
   await queryInterface.changeColumn('pacientes', 'data_nascimento', { type: Sequelize.DATEONLY });
     
  },

  async down (queryInterface, Sequelize) {
     await queryInterface.changeColumn('pacientes', 'data_nascimento', { type: Sequelize.DATE });
  
  }
};
