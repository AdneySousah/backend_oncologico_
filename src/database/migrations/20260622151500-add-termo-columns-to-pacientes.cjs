'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('pacientes', 'termo_data_aceite', {
      type: Sequelize.DATE,
      allowNull: true,
    });
    
    await queryInterface.addColumn('pacientes', 'termo_ip', {
      type: Sequelize.STRING,
      allowNull: true,
    });

    await queryInterface.addColumn('pacientes', 'termo_user_agent', {
      type: Sequelize.STRING,
      allowNull: true,
    });

    await queryInterface.addColumn('pacientes', 'termo_versao', {
      type: Sequelize.STRING,
      allowNull: true,
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('pacientes', 'termo_data_aceite');
    await queryInterface.removeColumn('pacientes', 'termo_ip');
    await queryInterface.removeColumn('pacientes', 'termo_user_agent');
    await queryInterface.removeColumn('pacientes', 'termo_versao');
  }
};