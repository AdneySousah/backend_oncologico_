'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('medicamentos', 'codigo_tuss', {
      type: Sequelize.STRING,
      allowNull: true,
    });
    await queryInterface.addColumn('medicamentos', 'laboratorio', {
      type: Sequelize.STRING,
      allowNull: true,
    });

    await queryInterface.addColumn('medicamentos', 'tipo_produto', {
      type: Sequelize.STRING,
      allowNull: true,
    });

    await queryInterface.addColumn('medicamentos', 'principio_ativo', {
      type: Sequelize.STRING,
      allowNull: true,
    });

    await queryInterface.addColumn('medicamentos', 'descricao', {
      type: Sequelize.STRING,
      allowNull: true,
    });
    await queryInterface.addColumn('medicamentos', 'qtd_capsula', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });
  },



  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('users');

  }
};
