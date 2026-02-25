'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
     await queryInterface.addColumn('pacientes', 'is_active', { type: Sequelize.BOOLEAN, defaultValue: true });
    
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.removeColumn('pacientes', 'is_active');

  }
};
