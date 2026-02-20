'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('evaluation_templates', 'is_active', {
      type: Sequelize.BOOLEAN,
      defaultValue: true, // Por padrão, nasce ativo
      allowNull: false,
    });

  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('evaluation_templates', 'is_active');

  }
};
