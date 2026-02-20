'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.addColumn('users', 'is_profissional', {
      type: Sequelize.BOOLEAN,
      defaultValue: false,
      allowNull: false,
    }),
    await queryInterface.addColumn('users','is_admin', {
      type: Sequelize.BOOLEAN,
      defaultValue: false,
      allowNull: false,

    });
     
  },

  async down (queryInterface, Sequelize) {
     await queryInterface.dropTable('users');
    
  }
};
