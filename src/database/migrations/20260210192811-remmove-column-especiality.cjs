'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
     await queryInterface.removeColumn('oncology_professionals', 'specialty');
    
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.addColumn('oncology_professionals', 'specialty', { type: Sequelize.INTEGER });
   
  }
};
