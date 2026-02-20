module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('entrevista_profissional', 'medico_id', {
      type: Sequelize.INTEGER,
      references: { model: 'medicos', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL', // Se apagar o médico, a entrevista não é perdida, apenas desvinculada
      allowNull: true, 
    });

    // Removendo as colunas antigas (faça backup dos dados antes se já estiver em produção!)
    await queryInterface.removeColumn('entrevista_profissional', 'nome');
    await queryInterface.removeColumn('entrevista_profissional', 'crm');
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('entrevista_profissional', 'nome', {
      type: Sequelize.STRING,
    });
    await queryInterface.addColumn('entrevista_profissional', 'crm', {
      type: Sequelize.STRING,
    });
    await queryInterface.removeColumn('entrevista_profissional', 'medico_id');
  }
};