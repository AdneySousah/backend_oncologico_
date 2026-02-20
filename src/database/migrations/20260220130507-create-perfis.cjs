'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('perfis', {
      id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
      },
      nome: {
        type: Sequelize.STRING,
        allowNull: false,
        unique: true, // Não pode ter dois perfis com o mesmo nome
      },
      permissoes: {
        type: Sequelize.JSONB,
        allowNull: false,
        // Estrutura padrão baseada nas suas rotas
        defaultValue: {
          usuarios: { acessar: false, editar: false, excluir: false },
          profissionais: { acessar: false, editar: false, excluir: false },
          especialidades: { acessar: false, editar: false, excluir: false },
          operadoras: { acessar: false, editar: false, excluir: false },
          pacientes: { acessar: false, editar: false, excluir: false },
          prestadores_medicos: { acessar: false, editar: false, excluir: false },
          diagnosticos: { acessar: false, editar: false, excluir: false },
          exames: { acessar: false, editar: false, excluir: false },
          comorbidades: { acessar: false, editar: false, excluir: false },
          entrevistas_medicas: { acessar: false, editar: false, excluir: false },
          avaliacoes: { acessar: false, editar: false, excluir: false },
          medicos: { acessar: false, editar: false, excluir: false },
          medicamentos: { acessar: false, editar: false, excluir: false },
          termos: { acessar: false, editar: false, excluir: false }
        }
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('perfis');
  }
};