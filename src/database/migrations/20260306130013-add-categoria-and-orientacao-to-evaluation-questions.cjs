module.exports = {
  up: async (queryInterface, Sequelize) => {
    // 1. Adiciona a coluna categoria
    await queryInterface.addColumn('evaluation_questions', 'categoria', {
      type: Sequelize.STRING,
      allowNull: true,
    });

    // 2. Adiciona o novo tipo 'orientacao' no ENUM (Específico para PostgreSQL)
    try {
      await queryInterface.sequelize.query(
        `ALTER TYPE "enum_evaluation_questions_tipo" ADD VALUE IF NOT EXISTS 'orientacao';`
      );
    } catch (e) {
      console.log("Aviso: Não foi possível atualizar o ENUM via SQL direto. Se estiver usando outro banco, ignore. Erro:", e.message);
    }
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('evaluation_questions', 'categoria');
    // Remover valores de ENUM no Postgres é complexo, normalmente deixamos o valor lá no down.
  }
};