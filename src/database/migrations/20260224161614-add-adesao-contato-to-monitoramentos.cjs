'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('monitoramento_medicamentos', 'contato_efetivo', {
      type: Sequelize.BOOLEAN,
      allowNull: true,
      defaultValue: true,
    });

    await queryInterface.addColumn('monitoramento_medicamentos', 'adesao_tratamento', {
      type: Sequelize.BOOLEAN,
      allowNull: true,
    });

    await queryInterface.addColumn('monitoramento_medicamentos', 'nivel_adesao', {
      type: Sequelize.STRING, // Usando STRING para facilitar a manutenção ('COMPLETAMENTE', 'PARCIALMENTE', 'NAO_ADERE')
      allowNull: true,
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('monitoramento_medicamentos', 'nivel_adesao');
    await queryInterface.removeColumn('monitoramento_medicamentos', 'adesao_tratamento');
    await queryInterface.removeColumn('monitoramento_medicamentos', 'contato_efetivo');
  }
};