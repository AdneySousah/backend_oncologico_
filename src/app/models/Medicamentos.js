import Sequelize, { Model } from "sequelize";

class Medicamentos extends Model {
    static init(sequelize) {
        super.init({
            external_id: Sequelize.INTEGER, // Adicionado para rastrear o ID da API externa
            nome: Sequelize.STRING,
            dosagem: Sequelize.STRING,
            tipo_dosagem: Sequelize.ENUM('MG', 'G', 'MCG', 'UI', 'ML', 'MG/ML'),
            codigo_tuss: Sequelize.STRING,
            laboratorio: Sequelize.STRING,
            tipo_produto: Sequelize.STRING,
            principio_ativo: Sequelize.STRING,
            descricao: Sequelize.STRING,
            qtd_capsula: Sequelize.INTEGER,
            nome_comercial: Sequelize.STRING,
            price: Sequelize.DECIMAL(10, 2),
            fornecedor: Sequelize.STRING,
            // --- NOVAS COLUNAS DA API EXTERNA ---
            apresentacao: Sequelize.STRING,
            via_administracao: Sequelize.STRING,
            tipo_matmed: Sequelize.STRING,
            tipo_medicamento: Sequelize.STRING,
        }, {
            sequelize,
            tableName: 'medicamentos',
        });
        return this;
    }

    static associate(models) {
        this.belongsToMany(models.EntrevistaMedica, {
            through: models.EntrevistaMedicamento,
            foreignKey: 'medicamento_id',
            otherKey: 'entrevista_profissional_id',
            as: 'entrevistas'
        });
        
        // Relacionamento com Paciente
        this.hasMany(models.Pacientes, { foreignKey: 'medicamento_id', as: 'pacientes' });
    }
}

export default Medicamentos;