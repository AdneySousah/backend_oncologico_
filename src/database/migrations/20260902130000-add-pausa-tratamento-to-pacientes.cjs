'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.addColumn('pacientes', 'tratamento_pausado', {
      type: Sequelize.BOOLEAN,
      defaultValue: false,
      allowNull: false
    });
    await queryInterface.addColumn('pacientes', 'motivo_pausa_tratamento', {
      type: Sequelize.TEXT,
      allowNull: true
    });
    await queryInterface.addColumn('pacientes', 'data_pausa_tratamento', {
      type: Sequelize.DATE,
      allowNull: true
    });
  },

  async down (queryInterface) {
    await queryInterface.removeColumn('pacientes', 'tratamento_pausado');
    await queryInterface.removeColumn('pacientes', 'motivo_pausa_tratamento');
    await queryInterface.removeColumn('pacientes', 'data_pausa_tratamento');
  }
};
