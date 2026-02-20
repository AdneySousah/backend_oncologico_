// arquivo: YYYYMMDDHHMMSS-add-comorbidade-id-to-infos-comorbidade.js
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('infos_comorbidade', 'comorbidade_id', {
      type: Sequelize.INTEGER,
      references: { model: 'comorbidades', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
      allowNull: true,
    });
    // Opcional: Remover a coluna de texto antigo se não for mais usar
    await queryInterface.removeColumn('infos_comorbidade', 'descricao_comorbidade');
  },

  down: async (queryInterface) => {
    await queryInterface.removeColumn('infos_comorbidade', 'comorbidade_id');
  }
};