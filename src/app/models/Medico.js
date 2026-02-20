import Sequelize, { Model } from "sequelize";

class Medico extends Model {
    static init(sequelize) {
        super.init({
            nome: Sequelize.STRING,
            crm: Sequelize.STRING,
        }, {
            sequelize,
            tableName: 'medicos',
        });
        return this;
    }

    static associate(models) {
        // Relacionamento N:N com as Clínicas/Hospitais
        this.belongsToMany(models.PrestadorMedico, {
            through: 'medicos_prestadores',
            as: 'locais_atendimento',
            foreignKey: 'medico_id'
        });
        
        // Relacionamento 1:N com as Entrevistas
        this.hasMany(models.EntrevistaMedica, {
            foreignKey: 'medico_id',
            as: 'entrevistas'
        });
    }
}

export default Medico;