'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
     await queryInterface.addColumn('operadoras', 'is_active', { type: Sequelize.BOOLEAN, defaultValue: true });

  },

  async down (queryInterface, Sequelize) {
    await queryInterface.removeColumn('operadoras', 'is_active');

  }
};
