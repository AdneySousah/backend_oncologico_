'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // 1. Permite que a avaliação exista sem uma entrevista
    await queryInterface.changeColumn('patient_evaluations', 'entrevista_profissional_id', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });

    // 2. Se a tabela de monitoramento também exigia, fazemos o mesmo
    await queryInterface.changeColumn('monitoramento_medicamentos', 'entrevista_profissional_id', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.changeColumn('patient_evaluations', 'entrevista_profissional_id', {
      type: Sequelize.INTEGER,
      allowNull: false,
    });

    await queryInterface.changeColumn('monitoramento_medicamentos', 'entrevista_profissional_id', {
      type: Sequelize.INTEGER,
      allowNull: false,
    });
  }
};